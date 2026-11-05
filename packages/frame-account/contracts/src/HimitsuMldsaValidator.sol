// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IFrameValidator} from "../vendor/erc8286/interfaces/IFrameValidator.sol";
import {LibERC8286} from "../vendor/erc8286/lib/LibERC8286.sol";
import {LibCloneConfig} from "../vendor/erc8286/lib/LibCloneConfig.sol";

interface IHimitsuMldsaVerifier {
    function verify(address descriptor, bytes calldata message, bytes calldata signature) external view returns (bool);
}

/// @notice ML-DSA-44 authorization cached in the installing ERC-8286 account.
/// @dev Expensive FIPS204 verification runs in execution, never the capped VERIFY prefix.
/// The signed message is EXACTLY the32-byte canonical EIP-8141 sig_hash. Its transaction
/// commits the chain, sender, nonce, every frame and fee. No caller-supplied hash authorizes
/// validation: validateFrame reads the executing transaction's actual sig_hash.
/// The underlying research verifier and prepared-key tooling are not independently audited.
contract HimitsuMldsaValidator is IFrameValidator {
    struct Layout {
        address descriptor;
        bytes32 descriptorHash;
        bool overrideKey;
        mapping(address => mapping(bytes32 => mapping(bytes32 => bool))) authorized;
    }

    // ERC-7201 namespace: himitsu.erc8286.mldsa44.validator.v1 (derived below).
    bytes32 private constant SLOT = bytes32(uint256(keccak256(abi.encode(uint256(keccak256("himitsu.erc8286.mldsa44.validator.v1")) - 1))) & ~uint256(0xff));
    address private immutable SELF = address(this);
    IHimitsuMldsaVerifier public immutable VERIFIER;
    bytes32 public immutable VERIFIER_CODE_HASH;
    error InvalidKey();
    error InvalidSignature();
    error VerifierChanged();
    event FrameAuthorizationCached(bytes32 indexed sigHash, address indexed descriptor);

    constructor(IHimitsuMldsaVerifier verifier) {
        if (address(verifier).code.length == 0) revert InvalidKey();
        VERIFIER = verifier;
        VERIFIER_CODE_HASH = address(verifier).codehash;
    }

    function _layout() private pure returns (Layout storage s) {
        bytes32 slot = SLOT;
        assembly { s.slot := slot }
    }

    /// @dev Clone configuration: prepared-key descriptor address20 || runtime hash32.
    /// The descriptor contains the public tr and four pinned row addresses/hashes.
    /// Clients must independently derive it from their actual ML-DSA public key.
    function _decode(bytes memory data) private pure returns (address descriptor, bytes32 hash) {
        if (data.length != 52) revert InvalidKey();
        assembly ("memory-safe") {
            descriptor := shr(96, mload(add(data, 32)))
            hash := mload(add(data, 52))
        }
        if (descriptor == address(0) || hash == bytes32(0)) revert InvalidKey();
    }

    function _key() private view returns (address descriptor, bytes32 hash) {
        Layout storage s = _layout();
        if (s.overrideKey) return (s.descriptor, s.descriptorHash);
        bytes memory args = LibCloneConfig.args();
        if (LibCloneConfig.validator(args) != SELF) return (address(0), bytes32(0));
        return _decode(LibCloneConfig.initData(args));
    }

    function onInstall(bytes calldata data) external override {
        Layout storage s = _layout();
        // Empty initialization locks the implementation instance, not a user key.
        if (data.length == 0) { s.overrideKey = true; s.descriptor = address(0); s.descriptorHash = 0; return; }
        (address descriptor, bytes32 hash) = _decode(data);
        if (descriptor.code.length != 273 || descriptor.codehash != hash) revert InvalidKey();
        s.descriptor = descriptor; s.descriptorHash = hash; s.overrideKey = true;
    }

    function onUninstall(bytes calldata) external override {
        Layout storage s = _layout();
        s.descriptor = address(0); s.descriptorHash = 0; s.overrideKey = true;
    }

    function isModuleType(uint256 id) external pure override returns (bool) {
        return id == LibERC8286.MODULE_TYPE_FRAME_VALIDATOR;
    }

    /// @notice Permissionless computation only: writes an authorization after valid ML-DSA.
    /// @dev Must be DELEGATECALLed by the fixed account wrapper. Calling this module directly
    /// changes only this module's independent storage and grants no account authority.
    function cacheFrameAuthorization(bytes32 sigHash, bytes calldata signature) external {
        (address descriptor, bytes32 hash) = _key();
        if (descriptor == address(0) || descriptor.code.length != 273 || descriptor.codehash != hash) revert InvalidKey();
        if (address(VERIFIER).codehash != VERIFIER_CODE_HASH) revert VerifierChanged();
        if (signature.length != 2420) revert InvalidSignature();
        bool valid;
        try VERIFIER.verify(descriptor, abi.encodePacked(sigHash), signature) returns (bool ok) { valid = ok; }
        catch { revert InvalidSignature(); }
        if (!valid) revert InvalidSignature();
        _layout().authorized[descriptor][hash][sigHash] = true;
        emit FrameAuthorizationCached(sigHash, descriptor);
    }

    function authorizationCached(bytes32 sigHash) external view returns (bool) {
        (address descriptor, bytes32 hash) = _key();
        return descriptor != address(0) && _layout().authorized[descriptor][hash][sigHash];
    }

    function validateFrame(bytes calldata data) external view override returns (uint8) {
        if (data.length != 0 || !LibERC8286.isTargetedFrame()) return LibERC8286.APPROVE_NONE;
        (address descriptor, bytes32 hash) = _key();
        if (descriptor == address(0) || !_layout().authorized[descriptor][hash][LibERC8286.sigHash()]) return LibERC8286.APPROVE_NONE;
        return LibERC8286.allowedScope(LibERC8286.currentFrameIndex());
    }
}
