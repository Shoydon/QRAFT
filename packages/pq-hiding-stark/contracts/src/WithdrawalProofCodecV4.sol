// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Goldilocks5 as G} from "./Goldilocks5.sol";
import {QuotientCheck as Q} from "./QuotientCheck.sol";
import {WithdrawalContext as W} from "./WithdrawalContext.sol";
/// @notice Fixed v4 indexed-commitment prover-message and AIR-window codec. No caller-chosen metadata or verifier key.
library WithdrawalProofCodecV4 {
 error Shape();
 struct Claims {bytes traceLocal;bytes traceNext;bytes prepLocal;bytes prepNext;bytes quotient;bytes random;bytes randomMask;bytes traceLocalMask;bytes traceNextMask;bytes quotientMasks;}
 bytes internal constant STARK_SEED=hex"c5000000000000000170332d756e69002d737461726b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c76befa35bfe000b5725aa66417b900cc6946096f261400b641d80878b9e600f793f83d7c00000000600000000800000000000000000c000000000800000000000000000b0000000008000000000000000aaa0000000800000000000000000006000000080000000000000000000000000008000000000000000010000000000800000000000000000100000008000000000000000001008000000000000000";
 bytes internal constant PCS_SEED=hex"85010000000000000170332d667269002d7063730000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000af631c1431f8b00f6a16a462fdc130030c8eb54fc76d6002de085b5d273f500d06d9503da000000012000000008000000000000000004000000000800000000000000000100000000080000000000000000010000000800000000000000000001000000080000000000000000020000000008000000000000000010000000000800000000000000000100000008000000000000000001000000000800000000000000000100000000080000000000000000010000000800000000000000000001000000080000000000000000010000000008000000000000000001000000000800000000000000000100000008000000000000000001000000000800000000000000000100000000080000000000000000010000000800000000000000000001000000080000000000000000010000000008000000000000000001000000000800000000000000000100000008000000000000000001000000000800000000000000000100000000080000000000000000028000000000";
 bytes internal constant FRI_SEED=hex"0d010000000000000170332d6672690000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000069a98ecec87e3007ef8d4a00880d600859fe89fc1c9c400fe7d6cf680b30100f42e5c424300000000a8000000080000000000000000040000000008000000000000000001000000000800000000000000000100000008000000000000000000010000000800000000000000000100000000080000000000000000010000000008000000000000000001000000080000000000000000010000000008000000000000000001000000000800000000000000000100000008000000000000000000010000000800000000000000000100000000080000000000000000010000000008000000000000000001800000000000";
 bytes internal constant PREPROCESSING_ROOT=hex"8554e959557260635f65cc32382ab653486fa51d1645bb504d137359fc2ded7a1a6ffc4e9b158e0da17e2c399f3260fd5a61c8385198258b19c4d1b8a3fe174f";
 function indexedCap(uint256 index,bytes memory root)internal pure returns(bytes memory){if(index>15||root.length!=64)revert Shape();return abi.encodePacked(uint32(index),root);}
 function starkMessage(bytes memory traceRoot,bytes memory root,bytes memory nullifier,bytes memory context)internal pure returns(bytes memory){
  if(traceRoot.length!=64)revert Shape();return bytes.concat(STARK_SEED,indexedCap(1,traceRoot),indexedCap(0,PREPROCESSING_ROOT),W.publicFieldsLE(root,nullifier,context));
 }
 function rootsMessage(bytes memory quotientRoot,bytes memory randomRoot)internal pure returns(bytes memory){if(quotientRoot.length!=64||randomRoot.length!=64)revert Shape();return bytes.concat(indexedCap(2,quotientRoot),indexedCap(3,randomRoot));}
 function friMessage(uint256 round,bytes memory root)internal pure returns(bytes memory){if(round>=12||root.length!=64)revert Shape();bytes memory cap=indexedCap(4+round,root);return round==0?bytes.concat(FRI_SEED,cap):cap;}
 function shape(Claims memory c)internal pure{
  if(c.traceLocal.length!=109200||c.traceNext.length!=109200||c.prepLocal.length!=240||c.prepNext.length!=240||c.quotient.length!=3200||c.random.length!=200||c.randomMask.length!=200||c.traceLocalMask.length!=200||c.traceNextMask.length!=200||c.quotientMasks.length!=3200)revert Shape();
 }
 function slice(bytes memory b,uint256 start,uint256 len)internal pure returns(bytes memory r){if(start>b.length||len>b.length-start)revert Shape();r=new bytes(len);assembly("memory-safe"){mcopy(add(r,32),add(add(b,32),start),len)}}
 function point(Claims memory c,uint256 i)internal pure returns(bytes memory r){
  shape(c);if(i==0)return bytes.concat(c.random,c.randomMask);if(i==1)return bytes.concat(c.traceLocal,c.traceLocalMask);if(i==2)return bytes.concat(c.traceNext,c.traceNextMask);
  if(i<19)return bytes.concat(slice(c.quotient,(i-3)*200,200),slice(c.quotientMasks,(i-3)*200,200));if(i==19)return c.prepLocal;if(i==20)return c.prepNext;revert Shape();
 }
 function pcsMessage(Claims memory c)internal pure returns(bytes memory r){
  shape(c);r=new bytes(PCS_SEED.length+226080);uint256 at;
  // Copy through local variables because Solidity constants have no stable memory address.
  bytes memory seed=PCS_SEED;assembly("memory-safe"){mcopy(add(r,32),add(seed,32),mload(seed))}at=seed.length;
  for(uint256 i;i<21;++i){bytes memory v=point(c,i);canonical(v);assembly("memory-safe"){mcopy(add(add(r,32),at),add(v,32),mload(v))}at+=v.length;}assert(at==r.length);
 }
 function canonical(bytes memory b)internal pure{
  if(b.length%8!=0)revert Shape();uint256 errorWord=uint32(G.NonCanonical.selector);
  // p=0xffffffff00000001. A LE-u64 is noncanonical exactly when
  // its high32bits are all ones and its low32bits are nonzero.
  assembly("memory-safe"){
   let end:=add(add(b,32),mload(b))
   for{let at:=add(b,32)}lt(at,end){at:=add(at,8)}{
    let x:=shr(192,mload(at))
    if and(eq(and(x,0xffffffff),0xffffffff),iszero(iszero(shr(32,x)))){mstore(0,shl(224,errorWord))revert(0,4)}
   }
  }
 }
 function extensionLE(uint256[5] memory a)internal pure returns(bytes memory r){G.check(a);r=new bytes(40);for(uint256 k;k<5;++k)for(uint256 j;j<8;++j)r[k*8+j]=bytes1(uint8(a[k]>>(8*j)));}
 function airWindow(Claims memory c,bytes memory root,bytes memory nullifier,bytes memory context,uint256[5] memory zeta)internal pure returns(bytes memory){
  shape(c);Q.Selectors memory s=Q.selectors(zeta);return bytes.concat(c.traceLocal,c.traceNext,c.prepLocal,c.prepNext,W.publicFieldsLE(root,nullifier,context),extensionLE(s.first),extensionLE(s.last),extensionLE(s.transition));
 }
}
