pragma circom 2.2.3;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

template JoinSplit(levels) {
 signal input root;
 signal input domain;
 signal input kind;
 signal input deposit;
 signal input withdrawal;
 signal input recipient;
 signal input nullifiers[4];
 signal input commitments[2];
 signal input digestHi;
 signal input digestLo;
 signal input spendingSecret;
 signal input inputAmounts[4];
 signal input inputRhos[4];
 signal input pathElements[4][levels];
 signal input pathIndices[4][levels];
 signal input outputAmounts[2];
 signal input outputOwners[2];
 signal input outputRhos[2];

 component secretBits=Num2Bits(253);secretBits.in<==spendingSecret;
 component owner=Poseidon(2);owner.inputs[0]<==1;owner.inputs[1]<==spendingSecret;
 component shield=IsEqual();shield.in[0]<==kind;shield.in[1]<==0;
 component transfer=IsEqual();transfer.in[0]<==kind;transfer.in[1]<==1;
 component withdraw=IsEqual();withdraw.in[0]<==kind;withdraw.in[1]<==2;
 shield.out+transfer.out+withdraw.out===1;
 deposit*(1-shield.out)===0;
 withdrawal*(1-withdraw.out)===0;
 recipient*(1-withdraw.out)===0;
 component depositBits=Num2Bits(128);depositBits.in<==deposit;
 component withdrawBits=Num2Bits(128);withdrawBits.in<==withdrawal;
 component recipientBits=Num2Bits(160);recipientBits.in<==recipient;
 component hi=Num2Bits(128);hi.in<==digestHi;
 component lo=Num2Bits(128);lo.in<==digestLo;
 component amountBits[4];component empty[4];component notes[4];component nulls[4];component nfZero[4];
 component tree[4][levels];signal nodes[4][levels+1];signal left[4][levels];signal right[4][levels];
 for(var i=0;i<4;i++) {
  amountBits[i]=Num2Bits(128);amountBits[i].in<==inputAmounts[i];
  empty[i]=IsZero();empty[i].in<==inputAmounts[i];
  shield.out*inputAmounts[i]===0;
  notes[i]=Poseidon(5);notes[i].inputs[0]<==2;notes[i].inputs[1]<==domain;
  notes[i].inputs[2]<==owner.out;notes[i].inputs[3]<==inputAmounts[i];notes[i].inputs[4]<==inputRhos[i];
  nulls[i]=Poseidon(3);nulls[i].inputs[0]<==3;nulls[i].inputs[1]<==spendingSecret;nulls[i].inputs[2]<==notes[i].out;
  nullifiers[i]===nulls[i].out*(1-empty[i].out);
  nfZero[i]=IsZero();nfZero[i].in<==nullifiers[i];nfZero[i].out===empty[i].out;
  nodes[i][0]<==notes[i].out;
  for(var j=0;j<levels;j++) {
   pathIndices[i][j]*(1-pathIndices[i][j])===0;
   left[i][j]<==nodes[i][j]+pathIndices[i][j]*(pathElements[i][j]-nodes[i][j]);
   right[i][j]<==pathElements[i][j]+pathIndices[i][j]*(nodes[i][j]-pathElements[i][j]);
   tree[i][j]=Poseidon(2);tree[i][j].inputs[0]<==left[i][j];tree[i][j].inputs[1]<==right[i][j];
   nodes[i][j+1]<==tree[i][j].out;
  }
  (nodes[i][levels]-root)*(1-empty[i].out)===0;
 }
 component outBits[2];component outEmpty[2];component outNote[2];component outZero[2];component ownerZero[2];component rhoZero[2];
 for(var o=0;o<2;o++) {
  outBits[o]=Num2Bits(128);outBits[o].in<==outputAmounts[o];
  outEmpty[o]=IsZero();outEmpty[o].in<==outputAmounts[o];
  ownerZero[o]=IsZero();ownerZero[o].in<==outputOwners[o];ownerZero[o].out*(1-outEmpty[o].out)===0;
  rhoZero[o]=IsZero();rhoZero[o].in<==outputRhos[o];rhoZero[o].out*(1-outEmpty[o].out)===0;
  outNote[o]=Poseidon(5);outNote[o].inputs[0]<==2;outNote[o].inputs[1]<==domain;
  outNote[o].inputs[2]<==outputOwners[o];outNote[o].inputs[3]<==outputAmounts[o];outNote[o].inputs[4]<==outputRhos[o];
  commitments[o]===outNote[o].out*(1-outEmpty[o].out);
  outZero[o]=IsZero();outZero[o].in<==commitments[o];outZero[o].out===outEmpty[o].out;
 }
 inputAmounts[0]+inputAmounts[1]+inputAmounts[2]+inputAmounts[3]+deposit===outputAmounts[0]+outputAmounts[1]+withdrawal;
}
component main {public [root,domain,kind,deposit,withdrawal,recipient,nullifiers,commitments,digestHi,digestLo]} = JoinSplit(20);
