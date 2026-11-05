// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Blake2b_512 as H} from "./Blake2b_512.sol";
import {BlakeMerkleV5 as M} from "./BlakeMerkleV5.sol";
import {CShake256V5 as X} from "./CShake256V5.sol";
/// @notice Total-order spBCS transcript: proof-wide salt, challenge-key/stream separation and write-back.
/// @dev Component memory state is not authority. The session reconstructs messages/statement
/// and authenticates all small state. No caller can choose keys, challenges or write-backs.
library StrongTranscriptV5 {
 uint256 constant P=18446744069414584321;
 uint256 internal constant MOVES=16;
 uint256 internal constant STREAM_BYTES=2560;
 uint256 internal constant MAX_HISTORY=1<<20;
 bytes internal constant DOMAIN="HIMITSU-SPBCS-CH-V5\x00";
 bytes internal constant PROFILE="HIMITSU-WITHDRAWAL-V5/q320-b16-e5\x00";
 struct State{
  bytes[16] records;M.Digest[16] writebacks;M.Digest proofSalt;bytes statement;
  uint256 moves;uint256 nextBlock;uint256 remaining;uint256 accepted;uint256 historyBytes;
  M.Digest key;bool hasKey;bytes32 outputA;bytes32 outputB;
 }
 error Shape();error MoveIncomplete();error MoveComplete();error NeedsRefill();error BlockNotConsumed();error Bounds();error KeyState();
 function init(M.Digest memory salt,bytes memory statement)internal pure returns(State memory s){if(statement.length==0||statement.length>4096)revert Shape();s.proofSalt=salt;s.statement=statement;}
 function beginMove(State memory s,bytes memory message)internal pure{
  if(s.moves>=16)revert Bounds();if(s.moves!=0&&s.accepted!=5)revert MoveIncomplete();if(message.length==0||message.length>MAX_HISTORY-s.historyBytes)revert Shape();
  s.records[s.moves]=message;s.historyBytes+=message.length;++s.moves;s.nextBlock=0;s.remaining=0;s.accepted=0;s.hasKey=false;s.key=M.Digest(0,0);
 }
 function inputForKey(State memory s)internal pure returns(bytes memory input){
  if(s.moves==0||s.moves>16||s.statement.length==0||s.statement.length>4096)revert Bounds();uint256 history;for(uint256 i;i<s.moves;++i)history+=s.records[i].length;
  if(history!=s.historyBytes||history>MAX_HISTORY)revert Shape();uint256 items=2*s.moves-1;
  input=new bytes(DOMAIN.length+64+4+s.statement.length+4+4+items*12+history+(s.moves-1)*64);
  copy(DOMAIN,input,0);uint256 at=DOMAIN.length;putDigest(input,at,s.proofSalt);at+=64;put32(input,at,s.statement.length);at+=4;copy(s.statement,input,at);at+=s.statement.length;put32(input,at,2*s.moves-1);at+=4;put32(input,at,items);at+=4;
  for(uint256 i;i<s.moves;++i){put32(input,at,2*i);at+=4;put64(input,at,s.records[i].length);at+=8;copy(s.records[i],input,at);at+=s.records[i].length;
   if(i+1<s.moves){put32(input,at,2*i+1);at+=4;put64(input,at,64);at+=8;putDigest(input,at,s.writebacks[i]);at+=64;}
  }assert(at==input.length);
 }
 function deriveKey(State memory s)internal view returns(M.Digest memory d){
  if(s.hasKey||s.nextBlock!=0||s.remaining!=0||s.accepted!=0)revert KeyState();bytes memory raw=inputForKey(s);bytes memory result=H.hash(raw);d=asDigest(result,0);s.key=d;s.hasKey=true;
 }
 function refill(State memory s)internal pure returns(M.Digest memory d){
  if(!s.hasKey||s.moves==0||s.moves>16)revert KeyState();if(s.remaining!=0)revert BlockNotConsumed();if(s.accepted>=(s.moves==16?320:5))revert MoveComplete();if(s.nextBlock>=40)revert Bounds();
  bytes memory output=X.stream(abi.encodePacked(s.key.a,s.key.b),abi.encodePacked(s.proofSalt.a,s.proofSalt.b));s.writebacks[s.moves-1]=asDigest(output,0);
  d=asDigest(output,STREAM_BYTES-64*(s.nextBlock+1));s.outputA=d.a;s.outputB=d.b;++s.nextBlock;s.remaining=64;
 }
 function sampleCoordinate(State memory s)internal pure returns(bool accepted,uint256 value){if(s.moves==0||s.moves>=16)revert Shape();if(s.accepted>=5)revert MoveComplete();value=takeWord(s);accepted=value<P;if(accepted)++s.accepted;}
 function sampleQuery(State memory s)internal pure returns(uint256 index){if(s.moves!=16)revert Shape();if(s.accepted>=320)revert MoveComplete();index=takeWord(s)&65535;++s.accepted;}
 function finish(State memory s)internal pure{if(s.moves!=16||s.accepted!=320||s.nextBlock!=40||s.remaining!=0)revert MoveIncomplete();}
 function takeWord(State memory s)private pure returns(uint256 value){if(s.remaining<8||s.remaining>64||s.remaining%8!=0)revert NeedsRefill();uint256 shift;bytes32 word;if(s.remaining>32){word=s.outputB;shift=(64-s.remaining)*8;}else{word=s.outputA;shift=(32-s.remaining)*8;}value=(uint256(word)>>shift)&type(uint64).max;s.remaining-=8;}
 function asDigest(bytes memory b,uint256 off)internal pure returns(M.Digest memory d){if(off>b.length||b.length-off<64)revert Shape();assembly("memory-safe"){mstore(d,mload(add(add(b,32),off)))mstore(add(d,32),mload(add(add(b,64),off)))}}
 function putDigest(bytes memory b,uint256 at,M.Digest memory d)private pure{assembly("memory-safe"){mstore(add(add(b,32),at),mload(d))mstore(add(add(b,64),at),mload(add(d,32)))}}
 function put32(bytes memory b,uint256 at,uint256 n)private pure{assembly("memory-safe"){mstore(add(add(b,32),at),shl(224,n))}}
 function put64(bytes memory b,uint256 at,uint256 n)private pure{assembly("memory-safe"){mstore(add(add(b,32),at),shl(192,n))}}
 function copy(bytes memory source,bytes memory target,uint256 off)private pure{assembly("memory-safe"){mcopy(add(add(target,32),off),add(source,32),mload(source))}}
}
