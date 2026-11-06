// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibERC8286 as F} from "../vendor/erc8286/lib/LibERC8286.sol";

/// @notice Bounded gas sponsorship for the fixed QRAFT devnet application.
/// @dev Grants payment only. Execution still requires the account's exact ML-DSA authorization.
interface IQraftPoolAmount {
    function denomination() external view returns (uint128);
}

contract QraftPoolPaymaster {
    address public immutable owner;
    uint256 public immutable deploymentChainId;
    address public immutable implementation;
    bytes32 public immutable implementationHash;
    address public immutable validator;
    bytes32 public immutable validatorHash;
    address public immutable pool;
    address public immutable verifier;
    address public immutable blobs;
    uint256 public constant NONCE_LIMIT = 1000;
    uint256 public constant MAX_COST = 1e12;
    uint256 public immutable DENOMINATION;

    constructor(address owner_, address implementation_, address validator_, address pool_, address verifier_, address blobs_) {
        require((block.chainid == 8141 || block.chainid == 1337) && owner_ != address(0), "chain/owner");
        deploymentChainId = block.chainid;
        require(implementation_.code.length != 0 && validator_.code.length != 0, "account dependencies");
        require(pool_.code.length != 0 && verifier_.code.length != 0 && blobs_.code.length != 0, "protocol dependencies");
        owner = owner_; implementation = implementation_; validator = validator_;
        implementationHash = implementation_.codehash; validatorHash = validator_.codehash;
        pool = pool_; verifier = verifier_; blobs = blobs_;
        DENOMINATION = IQraftPoolAmount(pool_).denomination();
        require(DENOMINATION != 0 && DENOMINATION <= 0.1 ether, "pool denomination");
    }

    receive() external payable {}

    /// @notice Stake only sponsor funds; this never grants execution authority over a wallet.
    function stake(address registry, uint32 delay) external payable {
        require(msg.sender == owner && registry != address(0), "owner/registry");
        (bool ok,) = registry.call{value: msg.value}(abi.encodeWithSignature("addStake(uint32)", delay));
        require(ok, "stake failed");
    }

    function supportsAccount(address account) public view returns (bool) {
        if (implementation.codehash != implementationHash || validator.codehash != validatorHash) return false;
        bytes memory code = account.code;
        if (code.length != 120) return false;
        // Immutable-args clone: pinned implementation + validator, execution-only scope,
        // all four frame modes, protocol route. Remaining bytes bind its own public key.
        bytes memory prefix = abi.encodePacked(hex"363d3d373d3d3d363d73", implementation,
            hex"5af43d82803e903d91602b57fd5bf3", validator, uint8(2), uint8(15), uint8(0));
        for (uint256 i; i < prefix.length; ++i) if (code[i] != prefix[i]) return false;
        return true;
    }

    function allowedAction(address target, uint256 value, bytes memory data) public view returns (bool) {
        if (target == pool) return (data.length == 68 && bytes4(data) == bytes4(keccak256("deposit(bytes32[2])")) && value == DENOMINATION)
            || (data.length == 292 && bytes4(data) == bytes4(keccak256("withdraw(bytes32[2],bytes32[2],address,address,uint128,uint64,bytes32)")) && value == 0);
        if (value == 0 && data.length >= 4 && target == verifier)
            return bytes4(data) == 0x4abe7861 || bytes4(data) == 0x2151d155; // openSession, attachProof
        if (value == 0 && data.length >= 4 && target == blobs)
            return bytes4(data) == bytes4(keccak256("begin(uint256)"))
                || bytes4(data) == bytes4(keccak256("append(uint256,bytes)"))
                || bytes4(data) == bytes4(keccak256("seal(uint256)"));
        return target != address(0) && data.length == 0 && value <= DENOMINATION;
    }

    function txp(uint256 p) private view returns (uint256 value) { assembly { value := txparam(p) } }
    function fp(uint256 i, uint256 p) private view returns (uint256 value) { assembly { value := frameparam(i, p) } }

    function pay() external {
        require(block.chainid == deploymentChainId && F.currentFrameIndex() == 1 && F.frameCount() == 3, "chain/shape");
        address sender = F.txSender();
        require(supportsAccount(sender) && F.nonceKeyCount() == 1 && F.nonceKey0() == uint160(validator), "QRAFT account");
        require(F.txNonce() < NONCE_LIMIT && F.signatureCount() == (deploymentChainId == 1337 ? 1 : 0), "nonce/signatures");
        require(txp(6) <= MAX_COST && txp(3) <= 1 && txp(4) <= 128 && txp(5) == 0 && txp(7) == 0, "fee budget");
        require(F.frameTarget(0) == sender && F.frameModeOf(0) == F.MODE_VERIFY && F.frameFlags(0) == 2 && fp(0, 8) == 0, "execution approval");
        require(keccak256(F.frameData(0)) == keccak256(abi.encodeWithSignature("verify(bytes)", bytes(""))), "verify data");
        require(F.frameTarget(1) == address(this) && F.frameModeOf(1) == F.MODE_VERIFY && F.frameFlags(1) == 1, "payment frame");
        require(F.frameDataLength(1) == 4 && fp(1, 8) == 0, "payment data/value");
        require(fp(0, 1) <= (deploymentChainId == 1337 ? 3000000 : 180000) && fp(0, 9) == 0 && fp(1, 1) <= 120000 && fp(1, 9) <= 97920, "prefix budget");
        require(F.frameModeOf(2) == F.MODE_SENDER && F.frameFlags(2) == 0, "execution frame");
        require(fp(2, 1) <= 14500000 && fp(2, 9) <= 40000000 && fp(2, 4) <= 125000, "execution budget");
        require(allowedAction(F.frameTarget(2), fp(2, 8), F.frameData(2)), "unsupported action");
        F.approveScope(F.APPROVE_PAYMENT);
    }

    /// @notice The owner controls sponsor funds, never the user's keys or principal.
    function withdraw(address payable to, uint256 amount) external {
        require(msg.sender == owner && to != address(0), "owner/recipient");
        (bool ok,) = to.call{value: amount}(""); require(ok, "withdraw failed");
    }
}
