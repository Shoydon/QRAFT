import {describe, expect, test} from 'bun:test';
import {derivePrivateKeys, encodePrivateAddress, decodePrivateAddress, createPrivateNote, encryptNote, decryptNote, exportRecovery, importRecovery} from '../src/lib/private-wallet/crypto';
import {selectNotes} from '../src/lib/private-wallet/planner';
const domain={chainId:1337,genesisHash:`0x${'11'.repeat(32)}`,pool:'0x0000000000000000000000000000000000001234'} as const;
describe('private wallet protocol boundaries',()=>{
 test('keys and receiving identity restore deterministically and reject another pool',()=>{
  const a=derivePrivateKeys(new Uint8Array(32).fill(1)),b=derivePrivateKeys(new Uint8Array(32).fill(1));
  expect(a.owner).toBe(b.owner);expect(a.receiving.publicKey).toEqual(b.receiving.publicKey);
  expect(a.signingSeed).not.toEqual(a.master);
  const address=encodePrivateAddress(domain,a);expect(decodePrivateAddress(address,domain).owner).toBe(a.owner);
  expect(()=>decodePrivateAddress(address,{...domain,pool:'0x0000000000000000000000000000000000004321'})).toThrow();
  expect(()=>decodePrivateAddress(address.slice(0,-1)+'!',domain)).toThrow();
 });
 test('recipient alone decrypts a commitment-bound note without receiving the spending secret',async()=>{
  const alice=derivePrivateKeys(new Uint8Array(32).fill(1)),bob=derivePrivateKeys(new Uint8Array(32).fill(2));
  const note=createPrivateNote(domain,bob.owner,15n),address=decodePrivateAddress(encodePrivateAddress(domain,bob),domain);
  const envelope=await encryptNote(domain,address,note);
  expect(await decryptNote(domain,bob,note.commitment,envelope)).toEqual(note);
  expect(await decryptNote(domain,alice,note.commitment,envelope)).toBeNull();
  const changed=new Uint8Array(envelope);changed[changed.length-1]=changed[changed.length-1]!^1;
  expect(await decryptNote(domain,bob,note.commitment,changed)).toBeNull();
  expect(await decryptNote(domain,bob,note.commitment+1n,envelope)).toBeNull();
  expect(envelope.length).toBe(1197);
 });
 test('portable backup restores without an original passkey or domain',async()=>{
  const keys=derivePrivateKeys(new Uint8Array(32).fill(3));
  const file=await exportRecovery(keys.master,domain,'a long recovery password');
  const restored=await importRecovery(file,'a long recovery password',domain);
  expect(restored.owner).toBe(keys.owner);
  await expect(importRecovery(file,'the wrong recovery password',domain)).rejects.toThrow();
 });
 test('selection returns exact change and excludes reserved/spent notes',()=>{
  const keys=derivePrivateKeys(new Uint8Array(32).fill(4));
  const notes=[10n,20n,40n].map((v,index)=>({...createPrivateNote(domain,keys.owner,v),index}));
  const plan=selectNotes(notes,25n,new Set());expect(plan.inputs.length).toBe(1);expect(plan.change).toBe(15n);
  const blocked=new Set([notes[2]!.commitment.toString()]);
  expect(selectNotes(notes,25n,blocked).change).toBe(5n);
  expect(()=>selectNotes(notes,80n,new Set())).toThrow('Insufficient');
 });
});
