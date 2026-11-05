import { expect, test } from 'bun:test';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { bytesToHex, hexToBytes } from 'viem';
import { createKey, preparePublicKey, signAuthorization, verifyAuthorization } from '../packages/pq-account/src/keys';
import { Frame, FrameMode, FrameTx, decodeFrameTransaction } from '../packages/frame-account/src/frametx';
import { createPqNote, derivePqNote, parsePqNote, PqNoteTree, serializePqNote } from '../src/lib/pq/note';
const deployment = { chainId:8141, genesisHash:'0x2036e3fe3eaaa15382a9befde816137b6b2cda1e3df8ca0c92e89bc17a3fca5a' as const, pool:'0x4D0f4a4a33B58Ca6D9c443ba17078FaA27419D6a' as const, denominationWei:'100000000000000' };

test('PQ notes round-trip and refuse classical notes or another deployment', () => {
  const note=createPqNote(deployment);
  expect(parsePqNote(serializePqNote(note),deployment)).toEqual(note);
  expect(()=>parsePqNote('project-note-v1:classical',deployment)).toThrow('Classical');
  expect(()=>parsePqNote(serializePqNote(note),{...deployment,chainId:1337})).toThrow('another');
});
test('commitment and nullifier match the SHA3-512 withdrawal relation', () => {
  const secret=Uint8Array.from({length:64},(_,i)=>i);
  const note=derivePqNote(deployment,secret);
  expect(note.commitment).toBe(bytesToHex(sha3_512(secret)));
  expect(note.nullifier).toBe(bytesToHex(sha3_512(secret.subarray(0,32))));
  expect(()=>derivePqNote(deployment,new Uint8Array(32))).toThrow();
});
test('all depth-32 SHA3-512 witnesses reconstruct the same authenticated root', () => {
  const tree=new PqNoteTree();
  const notes=Array.from({length:5},()=>createPqNote(deployment));
  for(const note of notes)tree.insert(note.commitment);
  for(const [index,note] of notes.entries()){
    const witness=tree.witness(note,index);let root=hexToBytes(note.commitment);
    for(let level=0;level<32;level++){
      const sibling=new Uint8Array(witness.siblings[level]!);
      root=sha3_512(witness.directions[level]?concatBytes(sibling,root):concatBytes(root,sibling));
    }
    expect(bytesToHex(root)).toBe(tree.root());
  }
  expect(()=>tree.witness(notes[0]!,1)).toThrow();
});
test('ML-DSA authorizes the exact native frame transaction and rejects changed intent', () => {
  // Deterministic public test vector, never used for a funded account.
  const key=createKey(new Uint8Array(32).fill(42));
  const tx=new FrameTx({chainId:8141,nonceKeys:[1],nonceSeq:0,sender:deployment.pool,maxPriorityFee:1,maxFee:128,frames:[
    new Frame({mode:FrameMode.VERIFY,flags:3,target:deployment.pool,gasLimit:180000,stateGasLimit:97920,data:'0x'}),
    new Frame({mode:FrameMode.SENDER,target:'0x0000000000000000000000000000000000000001',gasLimit:1000000,stateGasLimit:1000000,value:100n,data:'0x'}),
  ]});
  const signature=signAuthorization(key,tx.sigHash());
  expect(verifyAuthorization(key.publicKey,tx.sigHash(),signature)).toBe(true);
  const changed=new FrameTx({...tx,nonceSeq:1});
  expect(verifyAuthorization(key.publicKey,changed.sigHash(),signature)).toBe(false);
  expect(decodeFrameTransaction(tx.raw()).sigHash()).toBe(tx.sigHash());
  expect(preparePublicKey(key.publicKey).length).toBe(20545);
  key.seed.fill(0);
});
