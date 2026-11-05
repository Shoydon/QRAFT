// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Goldilocks F_p[X]/(X^5-3), coefficients in increasing powers of X.
/// @dev Matches Plonky3 0d803737b681774186cd283b1fd2d8e493655c82.
/// Inputs MUST use canonical limbs; these APIs reject rather than silently reduce.
/// Pure arithmetic only: this library does not verify a STARK or establish security parameters.
library Goldilocks5 {
    uint256 internal constant P = 18446744069414584321;
    uint256 internal constant FROBENIUS_ROOT = 1041288259238279555;
    error NonCanonical();
    error ZeroInverse();

    function checkBase(uint256 a) internal pure { if (a >= P) revert NonCanonical(); }
    function check(uint256[5] memory a) internal pure {
        for (uint256 i; i < 5; ++i) checkBase(a[i]);
    }
    function addBase(uint256 a, uint256 b) internal pure returns (uint256) {
        checkBase(a); checkBase(b); return addmod(a,b,P);
    }
    function subBase(uint256 a, uint256 b) internal pure returns (uint256) {
        checkBase(a); checkBase(b); return addmod(a,P-b,P);
    }
    function mulBase(uint256 a, uint256 b) internal pure returns (uint256) {
        checkBase(a); checkBase(b); return mulmod(a,b,P);
    }
    function powBase(uint256 a, uint256 exponent) internal pure returns (uint256 r) {
        checkBase(a); return _powBase(a,exponent);
    }
    function _powBase(uint256 a, uint256 exponent) private pure returns (uint256 r) {
        r = 1;
        while (exponent != 0) {
            if (exponent & 1 != 0) r = mulmod(r,a,P);
            exponent >>= 1;
            if (exponent != 0) a = mulmod(a,a,P);
        }
    }
    function inverseBase(uint256 a) internal pure returns (uint256) {
        checkBase(a); if (a == 0) revert ZeroInverse();
        return _powBase(a,P-2);
    }
    function one() internal pure returns (uint256[5] memory r) { r[0] = 1; }
    function fromBase(uint256 a) internal pure returns (uint256[5] memory r) {
        checkBase(a); r[0] = a;
    }
    function add(uint256[5] memory a, uint256[5] memory b) internal pure returns (uint256[5] memory r) {
        check(a); check(b);
        for (uint256 i; i < 5; ++i) r[i] = addmod(a[i],b[i],P);
    }
    function sub(uint256[5] memory a, uint256[5] memory b) internal pure returns (uint256[5] memory r) {
        check(a); check(b);
        for (uint256 i; i < 5; ++i) r[i] = addmod(a[i],P-b[i],P);
    }
    function neg(uint256[5] memory a) internal pure returns (uint256[5] memory r) {
        check(a);
        for (uint256 i; i < 5; ++i) r[i] = a[i] == 0 ? 0 : P-a[i];
    }
    function scale(uint256[5] memory a, uint256 b) internal pure returns (uint256[5] memory r) {
        check(a); checkBase(b);
        for (uint256 i; i < 5; ++i) r[i] = mulmod(a[i],b,P);
    }
    function mul(uint256[5] memory a, uint256[5] memory b) internal pure returns (uint256[5] memory) {
        check(a); check(b); return _mul(a,b);
    }
    function _mul(uint256[5] memory a, uint256[5] memory b) private pure returns (uint256[5] memory r) {
        // Unrolled schoolbook product, reduced by X^5=3. All intermediates use EVM modular arithmetic.
        assembly ("memory-safe") {
            let p := 18446744069414584321
            let b0 := mload(add(b,0))
            let b1 := mload(add(b,32))
            let b2 := mload(add(b,64))
            let b3 := mload(add(b,96))
            let b4 := mload(add(b,128))
            let c1 := mulmod(b1,3,p)
            let c2 := mulmod(b2,3,p)
            let c3 := mulmod(b3,3,p)
            let c4 := mulmod(b4,3,p)
            mstore(add(r,0),addmod(addmod(addmod(addmod(mulmod(mload(add(a,0)),b0,p),mulmod(mload(add(a,32)),c4,p),p),mulmod(mload(add(a,64)),c3,p),p),mulmod(mload(add(a,96)),c2,p),p),mulmod(mload(add(a,128)),c1,p),p))
            mstore(add(r,32),addmod(addmod(addmod(addmod(mulmod(mload(add(a,0)),b1,p),mulmod(mload(add(a,32)),b0,p),p),mulmod(mload(add(a,64)),c4,p),p),mulmod(mload(add(a,96)),c3,p),p),mulmod(mload(add(a,128)),c2,p),p))
            mstore(add(r,64),addmod(addmod(addmod(addmod(mulmod(mload(add(a,0)),b2,p),mulmod(mload(add(a,32)),b1,p),p),mulmod(mload(add(a,64)),b0,p),p),mulmod(mload(add(a,96)),c4,p),p),mulmod(mload(add(a,128)),c3,p),p))
            mstore(add(r,96),addmod(addmod(addmod(addmod(mulmod(mload(add(a,0)),b3,p),mulmod(mload(add(a,32)),b2,p),p),mulmod(mload(add(a,64)),b1,p),p),mulmod(mload(add(a,96)),b0,p),p),mulmod(mload(add(a,128)),c4,p),p))
            mstore(add(r,128),addmod(addmod(addmod(addmod(mulmod(mload(add(a,0)),b4,p),mulmod(mload(add(a,32)),b3,p),p),mulmod(mload(add(a,64)),b2,p),p),mulmod(mload(add(a,96)),b1,p),p),mulmod(mload(add(a,128)),b0,p),p))
        }
    }
    function square(uint256[5] memory a) internal pure returns (uint256[5] memory) {
        check(a); return _mul(a,a);
    }
    function pow(uint256[5] memory a, uint256 exponent) internal pure returns (uint256[5] memory r) {
        check(a); r = one();
        while (exponent != 0) {
            if (exponent & 1 != 0) r = _mul(r,a);
            exponent >>= 1;
            if (exponent != 0) a = _mul(a,a);
        }
    }
    /// @notice a^(p^power); period five, no exponent-size restriction.
    function frobenius(uint256[5] memory a, uint256 power) internal pure returns (uint256[5] memory) {
        check(a); return _frobenius(a,power % 5);
    }
    function _frobenius(uint256[5] memory a, uint256 power) private pure returns (uint256[5] memory r) {
        uint256 root = _powBase(FROBENIUS_ROOT,power);
        uint256 factor = 1;
        for (uint256 i; i < 5; ++i) {
            r[i] = mulmod(a[i],factor,P); factor = mulmod(factor,root,P);
        }
    }
    function inverse(uint256[5] memory a) internal pure returns (uint256[5] memory r) {
        check(a);
        if (a[0] | a[1] | a[2] | a[3] | a[4] == 0) revert ZeroInverse();
        // Same conjugate decomposition as pinned Plonky3 quintic_inv:
        // t = a^(p+p^2); t * t^(p^2) = a^(p+p^2+p^3+p^4).
        uint256[5] memory t = _frobenius(_mul(a,_frobenius(a,1)),1);
        uint256[5] memory conjugates = _mul(t,_frobenius(t,2));
        // Norm(a) is in F_p: compute only its constant coefficient.
        uint256 norm = mulmod(a[0],conjugates[0],P);
        for (uint256 i = 1; i < 5; ++i) {
            norm = addmod(norm,mulmod(3,mulmod(a[i],conjugates[5-i],P),P),P);
        }
        // Irreducibility ensures every nonzero input has nonzero base-field norm.
        uint256 invNorm = _powBase(norm,P-2);
        for (uint256 i; i < 5; ++i) r[i] = mulmod(conjugates[i],invNorm,P);
    }
    function div(uint256[5] memory a, uint256[5] memory b) internal pure returns (uint256[5] memory) {
        check(a); return _mul(a,inverse(b));
    }
}
