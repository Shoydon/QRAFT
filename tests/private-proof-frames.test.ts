import {describe,it,expect} from 'bun:test';
import {privateProofFramePlan} from '../src/lib/private-wallet/frames';
import {decodeFrameTransaction} from '../packages/frame-account/src/frametx';
const account='0x0000000000000000000000000000000000000001',sponsor='0x0000000000000000000000000000000000000002',pool='0x0000000000000000000000000000000000000003';
describe('direct proof-authorized submission',()=>{
 it('needs no offchain signature or shared sequential nonce',()=>{
  const a=privateProofFramePlan(account,sponsor,pool,'0x1234','0x01');
  const b=privateProofFramePlan(account,sponsor,pool,'0x5678','0x02');
  expect(a.signatures).toHaveLength(0);expect(a.nonceSeq).toBe(0n);expect(b.nonceSeq).toBe(0n);
  expect(a.nonceKeys).toEqual([1n]);expect(b.nonceKeys).toEqual([2n]);
  const decoded=decodeFrameTransaction(a.raw());expect(decoded.raw()).toBe(a.raw());
  expect(decoded.frames.map(f=>[f.mode,f.flags])).toEqual([[1,2],[1,1],[2,0]]);
  expect(decoded.frames.every(f=>f.value===0n)).toBe(true);
  expect(decoded.frames[2]!.target).toBe(pool);
 });
 it('refuses the legacy linear nonce lane',()=>{expect(()=>privateProofFramePlan(account,sponsor,pool,'0x','0x00')).toThrow();});
});

import {privateBootstrapPlan} from '../src/lib/private-wallet/frames';
import {createKey,signAtomic} from '../src/lib/atomic/account';
it('bootstrap owner signature binds its retry sequence and setup operation',()=>{
 const key=createKey(new Uint8Array(32).fill(7));
 const first=privateBootstrapPlan(account,key,sponsor,0n),retry=privateBootstrapPlan(account,key,sponsor,1n);
 expect(first.nonceKeys).toEqual(retry.nonceKeys);expect(first.sigHash()).not.toBe(retry.sigHash());
 expect(first.frames[2]!.target).toBe(account);expect(first.frames[2]!.value).toBe(0n);
 const signed=signAtomic(retry,key);expect(signed.sigHash()).toBe(retry.sigHash());expect(signed.signatures).toHaveLength(1);key.seed.fill(0);
});
