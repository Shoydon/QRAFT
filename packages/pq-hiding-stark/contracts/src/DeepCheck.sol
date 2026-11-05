// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Goldilocks5 as G} from "./Goldilocks5.sol";
/// @notice Fixed-profile hiding-PCS DEEP reduction. Authentication and staged progress belong to the caller.
/// @dev All projections use ascending gamma powers; row order is random, trace, sixteen quotient rows, preprocessing.
library DeepCheck {
 uint256 constant P=18446744069414584321;
 uint256 constant G65536=0x54df9630bf79450e;
 uint256 constant G2048=0x0653b4801da1c8cf;
 error Shape();
 function pointWidth(uint256 i)internal pure returns(uint256){if(i>20)revert Shape();return i==1||i==2?2735:i>=19?6:10;}
 function pointOffset(uint256 i)internal pure returns(uint256){if(i>20)revert Shape();if(i==0)return 0;if(i==1)return 10;if(i==2)return 2745;if(i<19)return 5480+(i-3)*10;if(i==19)return 5640;return 5646;}
 function isNext(uint256 i)internal pure returns(bool){if(i>20)revert Shape();return i==2||i==20;}
 function rowWidth(uint256 i)internal pure returns(uint256){if(i>18)revert Shape();return i==1?2735:i==18?6:10;}
 function readU64(bytes memory b,uint256 off)private pure returns(uint256 v){
  assembly("memory-safe"){
   let x:=shr(192,mload(add(add(b,32),off)))
   x:=or(shl(8,and(x,0x00ff00ff00ff00ff)),and(shr(8,x),0x00ff00ff00ff00ff))
   x:=or(shl(16,and(x,0x0000ffff0000ffff)),and(shr(16,x),0x0000ffff0000ffff))
   v:=and(or(shl(32,x),shr(32,x)),0xffffffffffffffff)
  }if(v>=P)revert G.NonCanonical();
 }
 /// @dev At most512 coefficients per bounded chunk. For a split polynomial, combine from highest to lowest chunk.
 function projectBase(bytes memory b,uint256[5] memory gamma)internal pure returns(uint256[5] memory r){
  G.check(gamma);if(b.length==0||b.length%8!=0||b.length>4096)revert Shape();
  for(uint256 n=b.length/8;n>0;){--n;r=product(r,gamma);r[0]=addmod(r[0],readU64(b,n*8),P);}
 }
 function projectExtension(bytes memory b,uint256[5] memory gamma)internal pure returns(uint256[5] memory r){
  G.check(gamma);if(b.length==0||b.length%40!=0||b.length>20480)revert Shape();
  for(uint256 n=b.length/40;n>0;){--n;r=product(r,gamma);for(uint256 k;k<5;++k)r[k]=addmod(r[k],readU64(b,n*40+k*8),P);}
 }
 /// @notice Append a lower-degree chunk to a previously projected higher-degree suffix.
 function appendLower(uint256[5] memory high,uint256[5] memory low,uint256 lowerWidth,uint256[5] memory gamma)internal pure returns(uint256[5] memory){
  if(lowerWidth==0||lowerWidth>512)revert Shape();return G.add(G.mul(high,G.pow(gamma,lowerWidth)),low);
 }
 function claimTotals(uint256[5][21] memory projections,uint256[5] memory gamma)internal pure returns(uint256[5][2] memory totals){
  for(uint256 i;i<21;++i){uint256 j=isNext(i)?1:0;totals[j]=G.add(totals[j],G.mul(projections[i],G.pow(gamma,pointOffset(i))));}
 }
 function queryPoint(uint256 index)internal pure returns(uint256){if(index>=65536)revert Shape();uint256 reversed;for(uint256 k;k<16;++k){reversed=(reversed<<1)|(index&1);index>>=1;}return mulmod(7,G.powBase(G65536,reversed),P);}
 /// @dev The caller MUST authenticate each full row and its projection against the fixed roots and this query index.
 function reduce(uint256[5] memory gamma,uint256[5] memory zeta,uint256 index,uint256[5][2] memory claimed,uint256[5][19] memory rows)internal pure returns(uint256[5] memory){
  uint256[5][2] memory actual;
  for(uint256 i;i<21;++i){uint256 row=i==0?0:i<=2?1:i<19?i-1:18;uint256 j=isNext(i)?1:0;actual[j]=G.add(actual[j],G.mul(rows[row],G.pow(gamma,pointOffset(i))));}
  uint256[5] memory x=G.fromBase(queryPoint(index));
  return G.add(G.div(G.sub(claimed[0],actual[0]),G.sub(zeta,x)),G.div(G.sub(claimed[1],actual[1]),G.sub(G.scale(zeta,G2048),x)));
 }
 // Input operands already canonical, avoiding repeated validation inside a projection loop.
 function product(uint256[5] memory a,uint256[5] memory b)private pure returns(uint256[5] memory r){
  assembly("memory-safe"){
   let p:=18446744069414584321
   let b0:=mload(b) let b1:=mload(add(b,32)) let b2:=mload(add(b,64)) let b3:=mload(add(b,96)) let b4:=mload(add(b,128))
   let c1:=mulmod(b1,3,p) let c2:=mulmod(b2,3,p) let c3:=mulmod(b3,3,p) let c4:=mulmod(b4,3,p)
   mstore(r,addmod(addmod(addmod(addmod(mulmod(mload(a),b0,p),mulmod(mload(add(a,32)),c4,p),p),mulmod(mload(add(a,64)),c3,p),p),mulmod(mload(add(a,96)),c2,p),p),mulmod(mload(add(a,128)),c1,p),p))
   mstore(add(r,32),addmod(addmod(addmod(addmod(mulmod(mload(a),b1,p),mulmod(mload(add(a,32)),b0,p),p),mulmod(mload(add(a,64)),c4,p),p),mulmod(mload(add(a,96)),c3,p),p),mulmod(mload(add(a,128)),c2,p),p))
   mstore(add(r,64),addmod(addmod(addmod(addmod(mulmod(mload(a),b2,p),mulmod(mload(add(a,32)),b1,p),p),mulmod(mload(add(a,64)),b0,p),p),mulmod(mload(add(a,96)),c4,p),p),mulmod(mload(add(a,128)),c3,p),p))
   mstore(add(r,96),addmod(addmod(addmod(addmod(mulmod(mload(a),b3,p),mulmod(mload(add(a,32)),b2,p),p),mulmod(mload(add(a,64)),b1,p),p),mulmod(mload(add(a,96)),b0,p),p),mulmod(mload(add(a,128)),c4,p),p))
   mstore(add(r,128),addmod(addmod(addmod(addmod(mulmod(mload(a),b4,p),mulmod(mload(add(a,32)),b3,p),p),mulmod(mload(add(a,64)),b2,p),p),mulmod(mload(add(a,96)),b1,p),p),mulmod(mload(add(a,128)),b0,p),p))
  }
 }
}
