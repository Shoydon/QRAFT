// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
interface IPrivateVerifier {function verifyProof(uint256[2] calldata,uint256[2][2] calldata,uint256[2] calldata,uint256[14] calldata) external view returns(bool);}
interface IPrivateHasher {function poseidon(uint256[2] calldata) external pure returns(uint256);}

/// Experimental ETH-only join/split pool. No privileged balance withdrawal.
contract PrivatePool {
 uint256 public constant FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617;
 uint256 public constant DEPTH=20;
 uint256 public constant ENVELOPE_BYTES=1197;
 IPrivateVerifier public immutable verifier;
 IPrivateHasher public immutable hasher;
 uint256 public immutable domain;
 uint256 public currentRoot;
 uint256 public nextIndex;
 uint256[20] private zeros;
 uint256[20] private filled;
 mapping(uint256=>bool) public roots;
 mapping(uint256=>bool) public spent;
 mapping(uint256=>bool) public commitments;
 uint256 private entered=1;
 struct Action {uint256 root;uint8 kind;uint128 deposit;uint128 withdrawal;address recipient;uint64 expiry;uint256[4] nullifiers;uint256[2] outputs;bytes[2] envelopes;}
 event Output(uint256 indexed commitment,uint32 leafIndex,uint256 root,bytes envelope);
 event Spent(uint256 indexed nullifier);
 event Settled(bytes32 indexed actionId,uint8 kind,uint128 deposit,uint128 withdrawal,address recipient);
 constructor(address verifier_,address hasher_,bytes32 genesis) {
  require(verifier_.code.length>0&&hasher_.code.length>0,"configuration");
  verifier=IPrivateVerifier(verifier_);hasher=IPrivateHasher(hasher_);
  domain=uint256(keccak256(abi.encode(keccak256("QRAFT_PRIVATE_ETH_V1"),block.chainid,genesis,address(this))))%FIELD;
  uint256 zero=uint256(keccak256("qraft.private.empty.v1"))%FIELD;
  for(uint256 i;i<DEPTH;i++){zeros[i]=zero;filled[i]=zero;zero=hasher.poseidon([zero,zero]);}
  currentRoot=zero;roots[zero]=true;
 }
 function actionDigest(Action calldata a) public view returns(bytes32) {
  return keccak256(abi.encode(keccak256("QRAFT_PRIVATE_ACTION_V1"),block.chainid,address(this),domain,a.root,a.kind,a.deposit,a.withdrawal,a.recipient,a.expiry,a.nullifiers,a.outputs,keccak256(a.envelopes[0]),keccak256(a.envelopes[1])));
 }
 function transact(Action calldata a,uint256[8] calldata proof) external payable {
  require(entered==1,"reentrancy");entered=2;
  require(a.kind<=2&&msg.value==a.deposit,"operation/value");
  require(block.timestamp<=a.expiry&&a.expiry<=block.timestamp+300,"expiry");
  require(roots[a.root],"root");
  if(a.kind==0)require(a.deposit>0&&a.withdrawal==0&&a.recipient==address(0),"shield");
  if(a.kind==1)require(a.deposit==0&&a.withdrawal==0&&a.recipient==address(0),"transfer");
  if(a.kind==2)require(a.deposit==0&&a.withdrawal>0&&a.recipient!=address(0)&&a.recipient!=address(this),"withdrawal");
  uint256 count;uint256 inputs;
  for(uint256 i;i<4;i++) {
   uint256 nf=a.nullifiers[i];require(nf<FIELD,"nullifier field");
   if(nf==0)continue;inputs++;require(!spent[nf],"spent");
   for(uint256 j;j<i;j++)require(nf!=a.nullifiers[j],"duplicate input");
  }
  require(a.kind==0?inputs==0:inputs>0,"input count");
  for(uint256 i;i<2;i++) {
   uint256 cm=a.outputs[i];require(cm<FIELD,"output field");
   if(cm==0){require(a.envelopes[i].length==0,"dummy envelope");continue;}
   count++;require(!commitments[cm]&&a.envelopes[i].length==ENVELOPE_BYTES&&a.envelopes[i][0]==0x01,"output");
  }
  require(a.outputs[0]==0||a.outputs[0]!=a.outputs[1],"duplicate output");
  require(nextIndex+count<=1<<DEPTH,"capacity");
  bytes32 id=actionDigest(a);uint256 digest=uint256(id);
  uint256[14] memory signals=[a.root,domain,uint256(a.kind),uint256(a.deposit),uint256(a.withdrawal),uint256(uint160(a.recipient)),a.nullifiers[0],a.nullifiers[1],a.nullifiers[2],a.nullifiers[3],a.outputs[0],a.outputs[1],digest>>128,uint256(uint128(digest))];
  require(verifier.verifyProof([proof[0],proof[1]],[[proof[2],proof[3]],[proof[4],proof[5]]],[proof[6],proof[7]],signals),"proof");
  for(uint256 i;i<4;i++)if(a.nullifiers[i]!=0){spent[a.nullifiers[i]]=true;emit Spent(a.nullifiers[i]);}
  for(uint256 i;i<2;i++)if(a.outputs[i]!=0)_insert(a.outputs[i],a.envelopes[i]);
  if(a.withdrawal>0){(bool ok,)=payable(a.recipient).call{value:a.withdrawal}("");require(ok,"payout");}
  emit Settled(id,a.kind,a.deposit,a.withdrawal,a.recipient);entered=1;
 }
 function _insert(uint256 cm,bytes calldata envelope) private {
  commitments[cm]=true;uint256 index=nextIndex++;uint256 cursor=index;uint256 node=cm;
  for(uint256 i;i<DEPTH;i++){if(cursor&1==0){filled[i]=node;node=hasher.poseidon([node,zeros[i]]);}else node=hasher.poseidon([filled[i],node]);cursor>>=1;}
  currentRoot=node;roots[node]=true;emit Output(cm,uint32(index),node,envelope);
 }
}
