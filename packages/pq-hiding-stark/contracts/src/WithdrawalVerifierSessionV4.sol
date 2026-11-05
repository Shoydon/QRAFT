// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {AirProgram} from "./AirProgram.sol";
import {Blake2b_512 as H} from "./Blake2b_512.sol";
import {IndexedBlakeMerkleV4 as M} from "./IndexedBlakeMerkleV4.sol";
import {FullPrefixTranscriptV4 as T} from "./FullPrefixTranscriptV4.sol";
import {WithdrawalProofCodecV4 as C} from "./WithdrawalProofCodecV4.sol";
import {DeepCheck as D} from "./DeepCheck.sol";
import {FriFoldV4 as F} from "./FriFoldV4.sol";
import {QuotientCheck as Q} from "./QuotientCheck.sol";

import {WithdrawalSessionArithmeticV4,WithdrawalSessionAuthenticationV4} from "./WithdrawalSessionComponentsV4.sol";
import {ProofBlobStore} from "./ProofBlobStore.sol";

/// @notice Authenticated staged verification. No funds and no caller-selected verifier authority.
/// Every reusable public input is bound with512-bit BLAKE2b. Only the exact consuming pool
/// may consume an exact statement after ALL transcript/AIR/MMCS/DEEP/FRI gates pass.
contract WithdrawalVerifierSessionV4 {
 enum Phase{Empty,Attach,Transcript,PrepareAir,Air,Quotient,Claims,Inputs,Fri,Verified,Consumed}
 error PhaseOrder();error Unauthorized();error Binding();error Shape();error ComponentCode();error Progress();error FinalMismatch();
 struct Material{M.Digest[3] roots;M.Digest[12] fri;uint256[5] finalConstant;M.Digest[16] salts;}
 struct Session{
  address opener;address consumer;Phase phase;bytes32[2] root;bytes32[2] nullifier;bytes32[2] context;Material material;
  uint256 claimsBlob;uint256 windowBlob;M.Digest claimsHash;M.Digest windowHash;uint256 nextMove;bool moveActive;uint256 tsMoves;uint256 tsBlock;uint256 tsRemaining;uint256 tsAccepted;uint256 tsHistory;bytes32 tsA;bytes32 tsB;
  uint256[5][15] challenges;uint256[320] indices;uint256 airBatch;uint256[5] accumulator;
  uint256 claimPoint;uint256 claimEnd;uint256[5] suffix;uint256[5][21] claimProjections;uint256[5][2] claimedTotals;
  uint256 query;uint256 group;uint256 row;uint256 rowEnd;uint256 authenticatedMatrices;
  M.Digest[19] rowHashes;uint256[5][19] rowProjections;uint256[5][320] values;uint256 friRound;uint256 friCursor;
 }
 AirProgram public immutable air;WithdrawalSessionArithmeticV4 public immutable arithmetic;WithdrawalSessionAuthenticationV4 public immutable authentication;
 ProofBlobStore public immutable blobs;
 bytes32 public constant AIR_CODE=bytes32(0);bytes32 public constant ARITHMETIC_CODE=bytes32(0);bytes32 public constant AUTHENTICATION_CODE=bytes32(0);bytes32 public constant BLOB_CODE=bytes32(0);
 uint256 public nextSession;mapping(bytes32=>Session)private sessions;
 event Opened(bytes32 indexed id,address indexed consumer,address indexed opener);event Verified(bytes32 indexed id);event Consumed(bytes32 indexed id);
 constructor(AirProgram a,WithdrawalSessionArithmeticV4 b,WithdrawalSessionAuthenticationV4 c,ProofBlobStore store){
  if(address(a).codehash!=AIR_CODE||address(b).codehash!=ARITHMETIC_CODE||address(c).codehash!=AUTHENTICATION_CODE||address(store).codehash!=BLOB_CODE)revert ComponentCode();air=a;arithmetic=b;authentication=c;blobs=store;
 }

 function openSession(address consumer,bytes32[2] calldata root,bytes32[2] calldata nullifier,bytes32[2] calldata context)external returns(bytes32 id){
  if(consumer==address(0))revert Shape();id=bytes32(++nextSession);Session storage s=sessions[id];s.opener=msg.sender;s.consumer=consumer;s.root=root;s.nullifier=nullifier;s.context=context;s.phase=Phase.Attach;emit Opened(id,consumer,msg.sender);
 }
 function attachProof(bytes32 id,Material calldata material,uint256 claimsBlob)external{
  Session storage s=sessions[id];_phase(s,Phase.Attach);if(msg.sender!=s.opener)revert Unauthorized();
  bytes memory encoded=blobs.read(claimsBlob);if(encoded.length>230000)revert Shape();C.Claims memory claims=abi.decode(encoded,(C.Claims));
  arithmetic.shape(claims,material.finalConstant);s.material=material;s.claimsBlob=claimsBlob;s.claimsHash=_claimsHash(claims);s.phase=Phase.Transcript;
 }
 /// Every record is reconstructed from immutable sealed public proof material.
 /// Only small progress counters/output words live in storage; no caller-supplied state.
 function beginTranscriptMove(bytes32 id)external{
  Session storage s=sessions[id];_phase(s,Phase.Transcript);if(s.moveActive||s.tsMoves!=s.nextMove)revert Progress();
  C.Claims memory claims;if(s.nextMove==2)claims=_loadClaims(s);bytes memory message=arithmetic.record(s.nextMove,claims,s.material.roots,s.material.fri,s.material.finalConstant,_bytes(s.root),_bytes(s.nullifier),_bytes(s.context));
  uint256 length=message.length+(s.nextMove==0?T.PROFILE.length:0);if(length>T.MAX_HISTORY-s.tsHistory)revert Shape();
  s.tsHistory+=length;++s.tsMoves;s.tsBlock=0;s.tsRemaining=0;s.tsAccepted=0;s.tsA=0;s.tsB=0;s.moveActive=true;
 }
 /// One RO block per call; same salt for all coordinates/rejections and320 joint queries.
 function transcriptBlock(bytes32 id)external{
  Session storage s=sessions[id];_phase(s,Phase.Transcript);if(!s.moveActive||s.tsMoves!=s.nextMove+1)revert Progress();T.State memory state=_transcriptState(s);T.refill(state);uint256 target=s.nextMove==15?320:5;
  while(state.remaining>=8&&state.accepted<target){uint256 at=state.accepted;if(s.nextMove==15)s.indices[at]=T.sampleQuery(state);else{(bool accepted,uint256 v)=T.sampleCoordinate(state);if(accepted)s.challenges[s.nextMove][at]=v;}}
  s.tsBlock=state.nextBlock;s.tsRemaining=state.remaining;s.tsAccepted=state.accepted;s.tsA=state.outputA;s.tsB=state.outputB;
  if(state.accepted==target){s.moveActive=false;++s.nextMove;if(s.nextMove==16){T.finish(state);s.phase=Phase.PrepareAir;}}
 }
 function prepareAir(bytes32 id,uint256 windowBlob)external{
  Session storage s=sessions[id];_phase(s,Phase.PrepareAir);C.Claims memory claims=_loadClaims(s);
  bytes memory expected=arithmetic.airWindow(claims,_bytes(s.root),_bytes(s.nullifier),_bytes(s.context),s.challenges[1]);bytes memory supplied=blobs.read(windowBlob);
  s.windowHash=_hash(expected);if(!_eq(_hash(supplied),s.windowHash))revert Binding();s.windowBlob=windowBlob;s.phase=Phase.Air;
 }

 function foldAirBatch(bytes32 id,bytes calldata program)external{
  Session storage s=sessions[id];_phase(s,Phase.Air);bytes memory window=blobs.read(s.windowBlob);if(!_eq(_hash(window),s.windowHash))revert Binding();(uint256[5] memory value,uint256 next)=air.foldBatch(s.airBatch,program,window,s.challenges[0],s.accumulator);if(next!=s.airBatch+1||next>93)revert Progress();s.accumulator=value;s.airBatch=next;if(next==93)s.phase=Phase.Quotient;
 }
 function checkQuotient(bytes32 id)external{
  Session storage s=sessions[id];_phase(s,Phase.Quotient);C.Claims memory claims=_loadClaims(s);arithmetic.quotient(claims,s.challenges[1],s.accumulator);s.phase=Phase.Claims;s.claimEnd=D.pointWidth(0);
 }
 function projectClaim(bytes32 id)external{
  Session storage s=sessions[id];_phase(s,Phase.Claims);C.Claims memory claims=_loadClaims(s);s.suffix=arithmetic.claimChunk(claims,s.claimPoint,s.claimEnd,s.challenges[2],s.suffix);s.claimEnd-=s.claimEnd>256?256:s.claimEnd;
  if(s.claimEnd==0){s.claimProjections[s.claimPoint]=s.suffix;delete s.suffix;++s.claimPoint;if(s.claimPoint==21){s.claimedTotals=arithmetic.claimTotals(s.claimProjections,s.challenges[2]);s.phase=Phase.Inputs;}else s.claimEnd=D.pointWidth(s.claimPoint);}
 }
 /// Four singleton MMCS groups authenticate19 matrices at the current transcript index.
 function authenticateInputGroup(bytes32 id,M.Opening calldata proof)external{
  Session storage s=sessions[id];_phase(s,Phase.Inputs);if(s.group>=4||s.query>=320)revert Progress();M.Kind kind;M.Digest memory root;uint256 offset;uint256 count;
  if(s.group==0){kind=M.Kind.Random;root=s.material.roots[2];offset=0;count=1;}else if(s.group==1){kind=M.Kind.AuthorizedTrace;root=s.material.roots[0];offset=1;count=1;}else if(s.group==2){kind=M.Kind.Quotient;root=s.material.roots[1];offset=2;count=16;}else{kind=M.Kind.Prep;root=arithmetic.preprocessingRoot();offset=18;count=1;}
  M.Digest[] memory hashes=authentication.inputRows(root,kind,s.indices[s.query],proof);if(hashes.length!=count)revert Shape();for(uint256 i;i<count;++i)s.rowHashes[offset+i]=hashes[i];s.authenticatedMatrices+=count;++s.group;if(s.group==4)s.rowEnd=D.rowWidth(0);
 }
 function projectInputRow(bytes32 id,bytes calldata row)external{
  Session storage s=sessions[id];_phase(s,Phase.Inputs);if(s.group!=4||s.row>=19)revert Progress();if(row.length!=D.rowWidth(s.row)*8||!_eq(_hash(row),s.rowHashes[s.row]))revert Binding();s.suffix=arithmetic.rowChunk(row,s.rowEnd,s.challenges[2],s.suffix);s.rowEnd-=s.rowEnd>512?512:s.rowEnd;
  if(s.rowEnd==0){s.rowProjections[s.row]=s.suffix;delete s.suffix;++s.row;if(s.row<19)s.rowEnd=D.rowWidth(s.row);}
 }
 /// Fast path: same authenticated row bindings, with all bounded projections in one call.
 function reduceInputRows(bytes32 id,bytes[] calldata rows)external{
  Session storage s=sessions[id];_phase(s,Phase.Inputs);if(s.group!=4||s.row!=0||s.rowEnd!=D.rowWidth(0)||rows.length!=19)revert Progress();
  for(uint256 i;i<19;++i)if(rows[i].length!=D.rowWidth(i)*8||!_eq(_hash(rows[i]),s.rowHashes[i]))revert Binding();
  uint256[5] memory value=arithmetic.reduceRows(rows,s.challenges[2],s.challenges[1],s.indices[s.query],s.claimedTotals);_completeInput(s,value);
 }
 /// Atomic input-query path: authenticates all19 matrices before reducing those exact rows.
 function verifyInputQuery(bytes32 id,M.Opening[4] calldata proof)external{
  Session storage s=sessions[id];_phase(s,Phase.Inputs);if(s.group!=0||s.row!=0||s.query>=320)revert Progress();bytes[] memory rows=new bytes[](19);uint256 at;
  for(uint256 group;group<4;++group){M.Kind kind;M.Digest memory root;uint256 count;
   if(group==0){kind=M.Kind.Random;root=s.material.roots[2];count=1;}else if(group==1){kind=M.Kind.AuthorizedTrace;root=s.material.roots[0];count=1;}else if(group==2){kind=M.Kind.Quotient;root=s.material.roots[1];count=16;}else{kind=M.Kind.Prep;root=arithmetic.preprocessingRoot();count=1;}
   M.Digest[] memory hashes=authentication.inputRows(root,kind,s.indices[s.query],proof[group]);if(hashes.length!=count)revert Shape();
   for(uint256 i;i<count;++i)rows[at++]=proof[group].rows[0][i];
  }
  if(at!=19)revert Shape();uint256[5] memory value=arithmetic.reduceRows(rows,s.challenges[2],s.challenges[1],s.indices[s.query],s.claimedTotals);s.authenticatedMatrices+=19;_completeInput(s,value);
 }
 function reduceInputQuery(bytes32 id)external{
  Session storage s=sessions[id];_phase(s,Phase.Inputs);if(s.group!=4||s.row!=19||s.rowEnd!=0)revert Progress();uint256[5] memory value=arithmetic.reduce(s.challenges[2],s.challenges[1],s.indices[s.query],s.claimedTotals,s.rowProjections);_completeInput(s,value);
 }
 /// Authenticated FRI subsets follow original query order,1..32 positions per call.
 function foldFri(bytes32 id,uint256[5][] calldata siblings,bytes[][] calldata salts,M.Digest[] calldata nodes)external{
  Session storage s=sessions[id];_phase(s,Phase.Fri);uint256 n=siblings.length;if(n==0||n>32||s.friCursor+n>320||s.friRound>=12)revert Shape();uint256[] memory indices=new uint256[](n);uint256[5][] memory carried=new uint256[5][](n);
  for(uint256 i;i<n;++i){indices[i]=s.indices[s.friCursor+i]>>s.friRound;carried[i]=s.values[s.friCursor+i];}
  (uint256[] memory next,uint256[5][] memory folded)=authentication.fri(s.friRound,s.challenges[3+s.friRound],indices,carried,siblings,s.material.fri[s.friRound],salts,nodes);if(next.length!=n||folded.length!=n)revert Shape();
  for(uint256 i;i<n;++i){if(next[i]!=(indices[i]>>1))revert Progress();if(s.friRound==11)for(uint256 k;k<5;++k)if(folded[i][k]!=s.material.finalConstant[k])revert FinalMismatch();s.values[s.friCursor+i]=folded[i];}
  s.friCursor+=n;if(s.friCursor==320){s.friCursor=0;++s.friRound;if(s.friRound==12){if(s.nextMove!=16||s.airBatch!=93||s.claimPoint!=21||s.query!=320||s.authenticatedMatrices!=6080)revert Progress();s.phase=Phase.Verified;emit Verified(id);}}
 }
 function consumeVerifiedWithdrawal(bytes32[2] calldata root,bytes32[2] calldata nullifier,bytes32[2] calldata context,bytes32 id)external returns(bool){
  Session storage s=sessions[id];_phase(s,Phase.Verified);if(msg.sender!=s.consumer)revert Unauthorized();for(uint256 i;i<2;++i)if(root[i]!=s.root[i]||nullifier[i]!=s.nullifier[i]||context[i]!=s.context[i])revert Binding();s.phase=Phase.Consumed;emit Consumed(id);return true;
 }
 function progress(bytes32 id)external view returns(Phase phase,uint256 moves,uint256 airBatches,uint256 points,uint256 queries,uint256 matrices,uint256 rounds,uint256 cursor){Session storage s=sessions[id];return(s.phase,s.nextMove,s.airBatch,s.claimPoint,s.query,s.authenticatedMatrices,s.friRound,s.friCursor);}

 function challenge(bytes32 id,uint256 move)external view returns(uint256[5] memory){if(move>=15)revert Shape();return sessions[id].challenges[move];}
 function queryIndex(bytes32 id,uint256 i)external view returns(uint256){if(i>=320)revert Shape();return sessions[id].indices[i];}
 function _completeInput(Session storage s,uint256[5] memory value)private{s.values[s.query]=value;++s.query;s.group=0;s.row=0;s.rowEnd=0;delete s.suffix;if(s.query==320)s.phase=Phase.Fri;}
 function _phase(Session storage s,Phase expected)private view{if(s.phase!=expected)revert PhaseOrder();}
 function _loadClaims(Session storage s)private view returns(C.Claims memory claims){bytes memory encoded=blobs.read(s.claimsBlob);if(encoded.length>230000)revert Shape();claims=abi.decode(encoded,(C.Claims));if(!_eq(_claimsHash(claims),s.claimsHash))revert Binding();}
 function _claimsHash(C.Claims memory c)private view returns(M.Digest memory){return _hash(abi.encode("HIMITSU-SESSION-CLAIMS-v1",c));}
 function _transcriptState(Session storage s)private view returns(T.State memory state){
  state.salts=s.material.salts;state.moves=s.tsMoves;state.nextBlock=s.tsBlock;state.remaining=s.tsRemaining;state.accepted=s.tsAccepted;state.historyBytes=s.tsHistory;state.outputA=s.tsA;state.outputB=s.tsB;
  C.Claims memory claims;C.Claims memory empty;if(state.moves>2)claims=_loadClaims(s);uint256 history;
  for(uint256 i;i<state.moves;++i){bytes memory message=arithmetic.record(i,i==2?claims:empty,s.material.roots,s.material.fri,s.material.finalConstant,_bytes(s.root),_bytes(s.nullifier),_bytes(s.context));state.records[i]=i==0?bytes.concat(T.PROFILE,message):message;history+=state.records[i].length;}
  if(history!=state.historyBytes)revert Binding();
 }

 function _hash(bytes memory data)private view returns(M.Digest memory d){bytes memory b=H.hash(data);assembly("memory-safe"){mstore(d,mload(add(b,32)))mstore(add(d,32),mload(add(b,64)))}}
 function _eq(M.Digest memory a,M.Digest memory b)private pure returns(bool){return a.a==b.a&&a.b==b.b;}
 function _bytes(bytes32[2] memory a)private pure returns(bytes memory){return abi.encodePacked(a[0],a[1]);}
}
