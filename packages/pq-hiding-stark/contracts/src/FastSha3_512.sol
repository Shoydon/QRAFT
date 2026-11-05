// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
/// @notice Standard FIPS202 SHA3-512: 72-byte rate, 0x06 domain, 64-byte output.
/// @dev Keccak-f[1600] helpers/round schedule adapted from ethereum-optimism/lib-keccak
/// commit b1c60dc34b927e69be7e2281cc07dc065409e1fe (MIT), copyright2023 clabby;
/// attribution geohot. License and exact upstream source in testdata/sha3-fast/.
/// Only the sponge wrapper is SHA3-512-specific; this is NOT EVM keccak256.
/// No claim of an independent cryptographic audit or complete proof verification.
library FastSha3_512 {
    uint64 private constant U64_MASK = 0xFFFFFFFFFFFFFFFF;
    bytes internal constant ROUND_CONSTANTS = abi.encode(
        0x00000000000000010000000000008082800000000000808a8000000080008000, // r1,r2,r3,r4
        0x000000000000808b000000008000000180000000800080818000000000008009, // r5,r6,r7,r8
        0x000000000000008a00000000000000880000000080008009000000008000000a, // r9,r10,r11,r12
        0x000000008000808b800000000000008b80000000000080898000000000008003, // r13,r14,r15,r16
        0x80000000000080028000000000000080000000000000800a800000008000000a, // r17,r18,r19,r20
        0x8000000080008081800000000000808000000000800000018000000080008008 // r21,r22,r23,r24
    );

 function hash(bytes memory input) internal pure returns(bytes memory output) {
  uint256[25] memory state;
  bytes memory constants=ROUND_CONSTANTS;
  output=new bytes(64);
  assembly("memory-safe") {
   function swap64(v)->r {
    v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
    v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
    r:=or(shl(32,and(v,0x00000000ffffffff)),shr(32,v))
   }
            // set a state element in the passed `StateMatrix` struct memory ptr.
            function setStateElem(ptr, idx, data) {
                mstore(add(ptr, shl(0x05, idx)), and(data, U64_MASK))
            }

            // fetch a state element from the passed `StateMatrix` struct memory ptr.
            function stateElem(ptr, idx) -> elem {
                elem := mload(add(ptr, shl(0x05, idx)))
            }

            // 64 bit logical shift
            function shl64(a, b) -> val {
                val := and(shl(a, b), U64_MASK)
            }

            // Performs an indivudual rho + pi computation, to be used in the full `thetaRhoPi` chain.
            function rhoPi(ptr, destIdx, srcIdx, fact, dt) {
                let xs1 := xor(stateElem(ptr, srcIdx), dt)
                let res := xor(shl(fact, xs1), shr(sub(64, fact), xs1))
                setStateElem(ptr, destIdx, res)
            }

            // xor a column in the state matrix
            function xorColumn(ptr, col) -> val {
                val :=
                    xor(
                        xor(xor(stateElem(ptr, col), stateElem(ptr, add(col, 5))), stateElem(ptr, add(col, 10))),
                        xor(stateElem(ptr, add(col, 15)), stateElem(ptr, add(col, 20)))
                    )
            }

            // Performs the `theta`, `rho`, and `pi` steps of the Keccak-f[1600] permutation on
            // the passed `StateMatrix` struct memory ptr.
            function thetaRhoPi(ptr) {
                // Theta
                let C0 := xorColumn(ptr, 0)
                let C1 := xorColumn(ptr, 1)
                let C2 := xorColumn(ptr, 2)
                let C3 := xorColumn(ptr, 3)
                let C4 := xorColumn(ptr, 4)
                let D0 := xor(xor(shl64(1, C1), shr(63, C1)), C4)
                let D1 := xor(xor(shl64(1, C2), shr(63, C2)), C0)
                let D2 := xor(xor(shl64(1, C3), shr(63, C3)), C1)
                let D3 := xor(xor(shl64(1, C4), shr(63, C4)), C2)
                let D4 := xor(xor(shl64(1, C0), shr(63, C0)), C3)

                let xs1 := xor(stateElem(ptr, 1), D1)
                let A1 := xor(shl(1, xs1), shr(63, xs1))

                let _ptr := ptr
                setStateElem(_ptr, 0, xor(stateElem(_ptr, 0), D0))
                rhoPi(_ptr, 1, 6, 44, D1)
                rhoPi(_ptr, 6, 9, 20, D4)
                rhoPi(_ptr, 9, 22, 61, D2)
                rhoPi(_ptr, 22, 14, 39, D4)
                rhoPi(_ptr, 14, 20, 18, D0)
                rhoPi(_ptr, 20, 2, 62, D2)
                rhoPi(_ptr, 2, 12, 43, D2)
                rhoPi(_ptr, 12, 13, 25, D3)
                rhoPi(_ptr, 13, 19, 8, D4)
                rhoPi(_ptr, 19, 23, 56, D3)
                rhoPi(_ptr, 23, 15, 41, D0)
                rhoPi(_ptr, 15, 4, 27, D4)
                rhoPi(_ptr, 4, 24, 14, D4)
                rhoPi(_ptr, 24, 21, 2, D1)
                rhoPi(_ptr, 21, 8, 55, D3)
                rhoPi(_ptr, 8, 16, 45, D1)
                rhoPi(_ptr, 16, 5, 36, D0)
                rhoPi(_ptr, 5, 3, 28, D3)
                rhoPi(_ptr, 3, 18, 21, D3)
                rhoPi(_ptr, 18, 17, 15, D2)
                rhoPi(_ptr, 17, 11, 10, D1)
                rhoPi(_ptr, 11, 7, 6, D2)
                rhoPi(_ptr, 7, 10, 3, D0)
                setStateElem(_ptr, 10, A1)
            }

            // Inner `chi` function, unrolled in `chi` for performance.
            function innerChi(ptr, start) {
                let A0 := stateElem(ptr, start)
                let A1 := stateElem(ptr, add(start, 1))
                let A2 := stateElem(ptr, add(start, 2))
                let A3 := stateElem(ptr, add(start, 3))
                let A4 := stateElem(ptr, add(start, 4))

                setStateElem(ptr, start, xor(A0, and(not(A1), A2)))
                setStateElem(ptr, add(start, 1), xor(A1, and(not(A2), A3)))
                setStateElem(ptr, add(start, 2), xor(A2, and(not(A3), A4)))
                setStateElem(ptr, add(start, 3), xor(A3, and(not(A4), A0)))
                setStateElem(ptr, add(start, 4), xor(A4, and(not(A0), A1)))
            }

            // Performs the `chi` step of the Keccak-f[1600] permutation on the passed `StateMatrix` struct memory ptr
            function chi(ptr) {
                innerChi(ptr, 0)
                innerChi(ptr, 5)
                innerChi(ptr, 10)
                innerChi(ptr, 15)
                innerChi(ptr, 20)
            }

            // Perform the full Keccak-f[1600] permutation on a `StateMatrix` struct memory ptr for a given round.
            function permute(ptr, roundsPtr, round) {
                // Theta, Rho, Pi, Chi
                thetaRhoPi(ptr)
                chi(ptr)
                // Iota
                let roundConst := shr(192, mload(add(roundsPtr, shl(0x03, round))))
                setStateElem(ptr, 0, xor(stateElem(ptr, 0), roundConst))
            }

   function permutation(stateMatrixPtr, rcPtr) {
    permute(stateMatrixPtr, rcPtr, 0)
    permute(stateMatrixPtr, rcPtr, 1)
    permute(stateMatrixPtr, rcPtr, 2)
    permute(stateMatrixPtr, rcPtr, 3)
    permute(stateMatrixPtr, rcPtr, 4)
    permute(stateMatrixPtr, rcPtr, 5)
    permute(stateMatrixPtr, rcPtr, 6)
    permute(stateMatrixPtr, rcPtr, 7)
    permute(stateMatrixPtr, rcPtr, 8)
    permute(stateMatrixPtr, rcPtr, 9)
    permute(stateMatrixPtr, rcPtr, 10)
    permute(stateMatrixPtr, rcPtr, 11)
    permute(stateMatrixPtr, rcPtr, 12)
    permute(stateMatrixPtr, rcPtr, 13)
    permute(stateMatrixPtr, rcPtr, 14)
    permute(stateMatrixPtr, rcPtr, 15)
    permute(stateMatrixPtr, rcPtr, 16)
    permute(stateMatrixPtr, rcPtr, 17)
    permute(stateMatrixPtr, rcPtr, 18)
    permute(stateMatrixPtr, rcPtr, 19)
    permute(stateMatrixPtr, rcPtr, 20)
    permute(stateMatrixPtr, rcPtr, 21)
    permute(stateMatrixPtr, rcPtr, 22)
    permute(stateMatrixPtr, rcPtr, 23)
   }
   let pos:=add(input,32)
   let remaining:=mload(input)
   // The SHA3-512 sponge rate is72bytes, capacity1024bits.
   for {} iszero(lt(remaining,72)) {} {
    for {let i:=0} lt(i,9) {i:=add(i,1)} {
     let q:=add(state,mul(i,32))
     mstore(q,xor(mload(q),swap64(shr(192,mload(add(pos,mul(i,8)))))))
    }
    permutation(state,add(constants,32))
    pos:=add(pos,72) remaining:=sub(remaining,72)
   }
   let whole:=div(remaining,8)
   for {let i:=0} lt(i,whole) {i:=add(i,1)} {
    let q:=add(state,mul(i,32))
    mstore(q,xor(mload(q),swap64(shr(192,mload(add(pos,mul(i,8)))))))
   }
   let tail:=mod(remaining,8)
   if tail {
    let q:=add(state,mul(whole,32))
    let value:=and(swap64(shr(192,mload(add(pos,mul(whole,8))))),sub(shl(mul(tail,8),1),1))
    mstore(q,xor(mload(q),value))
   }
   // SHA3 domain suffix0x06 and pad10*1. This also covers tail length71.
   let q:=add(state,mul(div(remaining,8),32))
   mstore(q,xor(mload(q),shl(mul(mod(remaining,8),8),6)))
   mstore(add(state,256),xor(mload(add(state,256)),0x8000000000000000))
   permutation(state,add(constants,32))
   mstore(add(output,32),or(or(shl(192,swap64(mload(state))),shl(128,swap64(mload(add(state,32))))),or(shl(64,swap64(mload(add(state,64)))),swap64(mload(add(state,96))))))
   mstore(add(output,64),or(or(shl(192,swap64(mload(add(state,128)))),shl(128,swap64(mload(add(state,160))))),or(shl(64,swap64(mload(add(state,192)))),swap64(mload(add(state,224))))))
  }
 }
 /// @notice Ordered internal Merkle node; exactly SHA3-512(left64 || right64).
 function node(bytes32[2] memory left,bytes32[2] memory right) internal pure returns(bytes32[2] memory r){
  bytes memory input=new bytes(128);
  assembly("memory-safe") {
   mstore(add(input,32),mload(left)) mstore(add(input,64),mload(add(left,32)))
   mstore(add(input,96),mload(right)) mstore(add(input,128),mload(add(right,32)))
  }
  bytes memory digest=hash(input);
  assembly("memory-safe") {mstore(r,mload(add(digest,32))) mstore(add(r,32),mload(add(digest,64)))}
 }
}
contract FastSha3_512Harness {
 function hash(bytes memory input) external pure returns(bytes memory){return FastSha3_512.hash(input);}
 function chain(bytes32[2] memory leaf,bytes32[2][32] memory siblings,uint32 directionBits)
  external pure returns(bytes32[2] memory){
   for(uint256 i;i<32;++i)leaf=(directionBits>>i)&1==0?FastSha3_512.node(leaf,siblings[i]):FastSha3_512.node(siblings[i],leaf);
   return leaf;
 }
 function dirtyTailHash(bytes memory input) external pure returns(bytes memory){
  assembly("memory-safe") {
   let end:=add(add(input,32),mload(input))
   for {let i:=0} lt(i,32) {i:=add(i,1)} {mstore8(add(end,i),0xff)}
  }
  return FastSha3_512.hash(input);
 }
 function dirtyHash(bytes memory input) external pure returns(bytes memory output,bytes32 sentinel){
  // Dirty future allocator memory without advancing it. hash must initialize its
  // state/output and may not absorb unrelated tail bytes or scratch data.
  assembly("memory-safe") {
   let free:=mload(0x40)
   for {let i:=0} lt(i,4096) {i:=add(i,32)} {mstore(add(free,i),not(0))}
  }
  output=FastSha3_512.hash(input);
  sentinel=keccak256(input); // Detect accidental mutation of caller input.
 }
}
