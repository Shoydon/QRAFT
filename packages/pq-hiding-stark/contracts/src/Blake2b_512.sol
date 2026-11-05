// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
/// @notice Experimental standard unkeyed BLAKE2b-512 (RFC7693) over EIP152 BLAKE2F.
/// @dev Original glue for the existing precompile; no new hash construction.
library Blake2b_512 {
 function hash(bytes memory input) internal view returns(bytes memory output){
  bytes memory buffer=new bytes(256); //213byte precompile payload plus safe scratch padding.
  output=new bytes(64);
  assembly("memory-safe") {
   function swap64(v)->r {
    v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
    v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
    r:=or(shl(32,and(v,0x00000000ffffffff)),shr(32,v))
   }
   let b:=add(buffer,32)
   mstore(b,shl(224,12))
   mstore(add(b,4),0x48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5)
   mstore(add(b,36),0xd182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b)
   let pos:=add(input,32)
   let remaining:=mload(input)
   if gt(remaining,0xffffffffffffffff) {revert(0,0)}
   let count:=0
   for {} 1 {} {
    let take:=remaining
    if gt(take,128) {take:=128}
    let m:=add(b,68)
    if eq(take,128) {
     mstore(m,mload(pos)) mstore(add(m,32),mload(add(pos,32)))
     mstore(add(m,64),mload(add(pos,64))) mstore(add(m,96),mload(add(pos,96)))
    }
    if lt(take,128) {
     mstore(m,0) mstore(add(m,32),0) mstore(add(m,64),0) mstore(add(m,96),0)
     let i:=0
     for {} iszero(gt(add(i,32),take)) {i:=add(i,32)} {mstore(add(m,i),mload(add(pos,i)))}
     for {} lt(i,take) {i:=add(i,1)} {mstore8(add(m,i),byte(0,mload(add(pos,i))))}
    }
    count:=add(count,take)
    // t0 is LE64, t1=0, final flag is one only for the final compression.
    mstore(add(b,196),shl(192,swap64(count)))
    let last:=iszero(gt(remaining,128))
    mstore8(add(b,212),last)
    if iszero(staticcall(gas(),9,b,213,add(output,32),64)) {revert(0,0)}
    if iszero(eq(returndatasize(),64)) {revert(0,0)}
    if last {break}
    mstore(add(b,4),mload(add(output,32)))
    mstore(add(b,36),mload(add(output,64)))
    pos:=add(pos,128) remaining:=sub(remaining,128)
   }
  }
 }
}
contract Blake2b_512Harness {
 function hash(bytes memory input) external view returns(bytes memory){return Blake2b_512.hash(input);}
}
