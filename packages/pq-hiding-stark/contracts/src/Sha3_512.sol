// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
/// @notice Experimental straightforward implementation of FIPS202 SHA3-512.
/// @dev Original implementation of the public standard, not a copied third-party library.
/// No security audit, verifier integration or production claim.
library Sha3_512 {
 function hash(bytes memory input) internal pure returns(bytes memory output) {
  uint256[25] memory state;
  uint256[25] memory scratchB;
  uint256[5] memory scratchC;
  bytes memory constants=hex"00000000000000010000000000008082800000000000808a8000000080008000000000000000808b000000008000000180000000800080818000000000008009000000000000008a00000000000000880000000080008009000000008000000a000000008000808b800000000000008b8000000000008089800000000000800380000000000080028000000000000080000000000000800a800000008000000a8000000080008081800000000000808000000000800000018000000080008008";
  output=new bytes(64);
  assembly("memory-safe") {
   function swap64(v)->r {
    v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
    v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
    r:=or(shl(32,and(v,0x00000000ffffffff)),shr(32,v))
   }
   function rol64(v,n)->r {r:=and(or(shl(n,v),shr(sub(64,n),v)),0xffffffffffffffff)}
   function permute(a,b,c,rc) {
    for {let round:=0} lt(round,24) {round:=add(round,1)} {
     // Theta: column parity, then neighboring column rotations.
     for {let x:=0} lt(x,5) {x:=add(x,1)} {
      let q:=add(a,mul(x,32))
      mstore(add(c,mul(x,32)),xor(xor(xor(xor(mload(q),mload(add(q,160))),mload(add(q,320))),mload(add(q,480))),mload(add(q,640))))
     }
     for {let x:=0} lt(x,5) {x:=add(x,1)} {
      let d:=xor(mload(add(c,mul(mod(add(x,4),5),32))),rol64(mload(add(c,mul(mod(add(x,1),5),32))),1))
      for {let y:=0} lt(y,5) {y:=add(y,1)} {let q:=add(a,mul(add(x,mul(y,5)),32)) mstore(q,xor(mload(q),d))}
     }
     // Rho and Pi: rotate each lane and move it to B[y,2x+3y].
     for {let y:=0} lt(y,5) {y:=add(y,1)} {for {let x:=0} lt(x,5) {x:=add(x,1)} {
      let i:=add(x,mul(y,5))
      let n:=and(shr(mul(i,8),0xe383d021208150f2d2927192b0a031437062c241b1c3e0100),255)
      let dest:=add(y,mul(mod(add(mul(2,x),mul(3,y)),5),5))
      mstore(add(b,mul(dest,32)),rol64(mload(add(a,mul(i,32))),n))
     }}
     // Chi: nonlinear rows. All lanes remain64bit values.
     for {let y:=0} lt(y,5) {y:=add(y,1)} {for {let x:=0} lt(x,5) {x:=add(x,1)} {
      let row:=mul(y,5)
      let v:=xor(mload(add(b,mul(add(row,x),32))),and(not(mload(add(b,mul(add(row,mod(add(x,1),5)),32)))),mload(add(b,mul(add(row,mod(add(x,2),5)),32)))))
      mstore(add(a,mul(add(row,x),32)),v)
     }}
     // Iota round constant, stored big-endian in the constant byte string.
     mstore(a,xor(mload(a),shr(192,mload(add(add(rc,32),mul(round,8))))))
    }
   }
   let pos:=add(input,32)
   let remaining:=mload(input)
   // The SHA3-512 sponge rate is72bytes, capacity1024bits.
   for {} iszero(lt(remaining,72)) {} {
    for {let i:=0} lt(i,9) {i:=add(i,1)} {
     let q:=add(state,mul(i,32))
     mstore(q,xor(mload(q),swap64(shr(192,mload(add(pos,mul(i,8)))))))
    }
    permute(state,scratchB,scratchC,constants)
    pos:=add(pos,72) remaining:=sub(remaining,72)
   }
   for {let i:=0} lt(i,remaining) {i:=add(i,1)} {
    let q:=add(state,mul(div(i,8),32))
    mstore(q,xor(mload(q),shl(mul(mod(i,8),8),byte(0,mload(add(pos,i))))))
   }
   // SHA3 domain suffix0x06 and pad10*1. This also covers tail length71.
   let q:=add(state,mul(div(remaining,8),32))
   mstore(q,xor(mload(q),shl(mul(mod(remaining,8),8),6)))
   mstore(add(state,256),xor(mload(add(state,256)),0x8000000000000000))
   permute(state,scratchB,scratchC,constants)
   mstore(add(output,32),or(or(shl(192,swap64(mload(state))),shl(128,swap64(mload(add(state,32))))),or(shl(64,swap64(mload(add(state,64)))),swap64(mload(add(state,96))))))
   mstore(add(output,64),or(or(shl(192,swap64(mload(add(state,128)))),shl(128,swap64(mload(add(state,160))))),or(shl(64,swap64(mload(add(state,192)))),swap64(mload(add(state,224))))))
  }
 }
}
contract Sha3_512Harness {
 function hash(bytes memory input) external pure returns(bytes memory){return Sha3_512.hash(input);}
}
