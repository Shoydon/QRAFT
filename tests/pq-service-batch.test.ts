import {test,expect} from 'bun:test';
import {keccak256,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {Frame,FrameTx} from '../packages/frame-account/src/frametx';
import {publicBatchPlan,publicBatchFitsRelay,verifyPublicBatch} from '../src/lib/pq/service-batch-frames';
import {signServiceFrame,serviceFrameSigner} from '../src/lib/pq/service-frames';
const account=privateKeyToAccount(`0x${'12'.repeat(32)}`);
const calls=Array.from({length:4},(_,i)=>({to:'0x0000000000000000000000000000000000001234' as Hex,data:`0x1234000${i}` as Hex}));
const operation={operator:account.address,nonceKey:BigInt(keccak256('0x1234')),nonce:0n,calls};
test('large input openings can shrink before the canonical serializer rejects them',async()=>{
 const openings=calls.map(call=>({...call,data:`0x${'ab'.repeat(34020)}` as Hex}));
 const large=publicBatchPlan({...operation,calls:openings});
 expect(()=>large.raw()).toThrow('128KiB');
 expect(publicBatchFitsRelay(large)).toBe(false);
 const smaller=publicBatchPlan({...operation,calls:openings.slice(0,2)});
 expect(publicBatchFitsRelay(smaller)).toBe(true);
 const signed=signServiceFrame(smaller,await account.sign({hash:smaller.sigHash()}));
 expect(publicBatchFitsRelay(signed)).toBe(true);
 expect(signed.raw().length).toBe(smaller.raw().length);
 const oversized=publicBatchPlan({...operation,calls:[{...calls[0]!,data:`0x${'ab'.repeat(131072)}`} ]});
 expect(publicBatchFitsRelay(oversized)).toBe(false);
});
test('proof batches bind ordered calls and link atomic frames with independent limits',async()=>{
 const plan=publicBatchPlan(operation);const signed=signServiceFrame(plan,await account.sign({hash:plan.sigHash()}));
 expect(plan.chainId).toBe(1337n);
 expect(plan.frames.map(f=>f.flags)).toEqual([3,4,4,4,0]);
 expect(plan.frames.slice(1).map(f=>f.data)).toEqual(calls.map(c=>c.data));
 expect(plan.frames.reduce((sum,f)=>sum+f.gasLimit+f.stateGasLimit,0n)).toBeLessThan(25000000n);
 expect(await serviceFrameSigner(signed)).toBe(account.address);
 expect(verifyPublicBatch(signed.raw(),operation).transactionHash()).toBe(signed.transactionHash());
 expect(()=>verifyPublicBatch(signed.raw(),{...operation,calls:[...calls].reverse()})).toThrow('ordered program');
 expect(()=>verifyPublicBatch(signed.raw(),{...operation,nonce:1n})).toThrow('ordered program');
 const altered=new FrameTx({...signed,frames:signed.frames.map((f,i)=>i===1?new Frame({...f,flags:0}):f)});
 expect(()=>verifyPublicBatch(altered.raw(),operation)).toThrow('ordered program');
});
test('smaller proof groups retain full validation and bounded budgets',()=>{
 for(const count of [1,2,3,4]){
  const tx=publicBatchPlan({...operation,calls:calls.slice(0,count)});
  expect(tx.frames).toHaveLength(count+1);
  expect(tx.frames.at(-1)!.flags).toBe(0);
  expect(tx.frames.slice(1).every(f=>f.value===0n&&f.mode===2)).toBe(true);
  expect(tx.frames.reduce((sum,f)=>sum+f.gasLimit+f.stateGasLimit,0n)).toBeLessThan(25000000n);
 }
 expect(()=>publicBatchPlan({...operation,calls:[]})).toThrow();
 expect(()=>publicBatchPlan({...operation,calls:[...calls,calls[0]!]})).toThrow();
});

test('budget rebalancing preserves already signed proof groups',async()=>{
 const legacy=publicBatchPlan(operation,true);const signed=signServiceFrame(legacy,await account.sign({hash:legacy.sigHash()}));
 expect(verifyPublicBatch(signed.raw(),operation).transactionHash()).toBe(signed.transactionHash());
 expect(publicBatchPlan(operation).frames[1]!.gasLimit).toBe(4000000n);
 expect(publicBatchPlan(operation).frames[1]!.stateGasLimit).toBe(2000000n);
 const pair={...operation,calls:calls.slice(0,2)};
 const priorPair=publicBatchPlan(pair,true);
 const signedPair=signServiceFrame(priorPair,await account.sign({hash:priorPair.sigHash()}));
 expect(verifyPublicBatch(signedPair.raw(),pair).transactionHash()).toBe(signedPair.transactionHash());
 expect(publicBatchPlan(pair).frames[1]!.gasLimit).toBe(11000000n);
 expect(publicBatchPlan(pair).frames[1]!.stateGasLimit).toBe(1300000n);
});
