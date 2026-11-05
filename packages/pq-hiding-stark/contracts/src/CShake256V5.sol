// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
/// @notice SP800185 cSHAKE256, N empty, S=HIMITSU-SPBCS-STREAM-V5, fixed2560-byte output.
/// @dev Keccak-f[1600] helpers/round schedule adapted from ethereum-optimism/lib-keccak
/// commit b1c60dc34b927e69be7e2281cc07dc065409e1fe (MIT), copyright2023 clabby;
/// attribution geohot. License and exact upstream source in testdata/sha3-fast/.
/// Standard1088-bit rate/512-bit capacity, cSHAKE domain0x04. No hash shortcut or invented XOF.
/// No claim of an independent cryptographic audit or complete proof verification.
library CShake256V5 {
    uint64 private constant U64_MASK = 0xFFFFFFFFFFFFFFFF;
    bytes internal constant ROUND_CONSTANTS = abi.encode(
        0x00000000000000010000000000008082800000000000808a8000000080008000, // r1,r2,r3,r4
        0x000000000000808b000000008000000180000000800080818000000000008009, // r5,r6,r7,r8
        0x000000000000008a00000000000000880000000080008009000000008000000a, // r9,r10,r11,r12
        0x000000008000808b800000000000008b80000000000080898000000000008003, // r13,r14,r15,r16
        0x80000000000080028000000000000080000000000000800a800000008000000a, // r17,r18,r19,r20
        0x8000000080008081800000000000808000000000800000018000000080008008 // r21,r22,r23,r24
    );

 bytes internal constant PREFIX=hex"0188010001b848494d495453552d53504243532d53545245414d2d56350000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
 error Shape();
 function stream(bytes memory key,bytes memory salt)internal pure returns(bytes memory output){
  if(key.length!=64||salt.length!=64)revert Shape();
  bytes memory input=bytes.concat(PREFIX,key,salt);
  uint256[25] memory state;
  bytes memory constants=ROUND_CONSTANTS;
  output=new bytes(2560);
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
   // bytepad(encode_string(N)||encode_string(S),136) precedes key||proofsalt.
   for {} iszero(lt(remaining,136)) {} {
    for {let i:=0} lt(i,17) {i:=add(i,1)} {
     let q:=add(state,mul(i,32))
     mstore(q,xor(mload(q),swap64(shr(192,mload(add(pos,mul(i,8)))))))
    }
    permutation(state,add(constants,32))
    pos:=add(pos,136) remaining:=sub(remaining,136)
   }
   // The fixed input leaves exactly128bytes after the one-block bytepad prefix.
   for {let i:=0} lt(i,16) {i:=add(i,1)} {
    let q:=add(state,mul(i,32))
    mstore(q,xor(mload(q),swap64(shr(192,mload(add(pos,mul(i,8)))))))
   }
   mstore(add(state,512),xor(mload(add(state,512)),0x8000000000000004))
   permutation(state,add(constants,32))
   let written:=0
   for {} lt(written,2560) {} {
    let take:=sub(2560,written)
    if gt(take,136){take:=136}
    for {let at:=0} lt(at,take) {at:=add(at,8)} {
     let lane:=mload(add(state,mul(div(at,8),32)))
     for {let j:=0} lt(j,8) {j:=add(j,1)} {
      mstore8(add(add(output,32),add(add(written,at),j)),and(shr(mul(j,8),lane),255))
     }
    }
    written:=add(written,take)
    if lt(written,2560){permutation(state,add(constants,32))}
   }
  }
 }
}
