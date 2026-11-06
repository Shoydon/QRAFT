// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC8286FrameAccount} from "../vendor/erc8286/ERC8286FrameAccount.sol";
import {LibERC8286} from "../vendor/erc8286/lib/LibERC8286.sol";
import {QraftMldsaValidator} from "./QraftMldsaValidator.sol";

/// @notice Reference ERC-8286 account plus a fixed ML-DSA cache-computation entry point.
contract QraftFrameAccount is ERC8286FrameAccount {
    address public immutable MLDSA_VALIDATOR;
    bytes32 public immutable MLDSA_VALIDATOR_CODE_HASH;
    error ValidatorUnavailable();

    constructor(address validator)
        ERC8286FrameAccount(validator, "", 3, _initialModes(), LibERC8286.EXECUTION_ROUTE_PROTOCOL)
    {
        require(validator.code.length != 0, "missing validator");
        MLDSA_VALIDATOR = validator;
        MLDSA_VALIDATOR_CODE_HASH = validator.codehash;
    }

    /// @notice Anyone can fund this account's fixed devnet stake; no wallet balance is spent.
    function stakeForAltMempool() external payable {
        require(block.chainid == 1337 && msg.value != 0, "chain/value");
        (bool ok,) = address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value: msg.value}(
            abi.encodeWithSignature("addStake(uint32)", uint32(86400))
        );
        require(ok, "stake failed");
    }

    function _initialModes() private pure returns (bytes32[] memory modes) {
        modes = new bytes32[](4);
        modes[0] = LibERC8286.FRAME_MODE_SINGLE;
        modes[1] = LibERC8286.FRAME_MODE_SINGLE_ATOMIC;
        modes[2] = LibERC8286.FRAME_MODE_BATCH;
        modes[3] = LibERC8286.FRAME_MODE_BATCH_ATOMIC;
    }

    /// @notice Anyone may pay for verification; only a valid signature can populate a cache.
    /// @dev The caller never chooses a delegatecall target, calldata selector or key.
    function cacheAuthorization(bytes32 sigHash, bytes calldata signature) external {
        address validator = MLDSA_VALIDATOR;
        if (!isValidatorInstalled(validator) || validator.codehash != MLDSA_VALIDATOR_CODE_HASH) revert ValidatorUnavailable();
        (bool ok, bytes memory result) = validator.delegatecall(
            abi.encodeCall(QraftMldsaValidator.cacheFrameAuthorization, (sigHash, signature))
        );
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
    }
}
