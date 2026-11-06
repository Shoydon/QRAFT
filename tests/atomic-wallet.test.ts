import {test,expect} from 'bun:test';
import {encodeFunctionData,bytesToHex,keccak256,type Hex} from 'viem';
import {Frame,FrameTx} from '../packages/frame-account/src/frametx';
import {atomicPlan,signAtomic,createKey,poolAbi} from '../src/lib/atomic/account';
import {verifyAuthorization} from '../packages/pq-account/src/keys';
import {createNote,parseNote} from '../src/lib/atomic/note';
import {withdrawalDigest} from '../src/lib/atomic/proof';
const account='0x1111111111111111111111111111111111111111',pool='0x2222222222222222222222222222222222222222',paymaster='0x3333333333333333333333333333333333333333';
test('native authorization binds nonce, payer, action, value and every frame',()=>{
 const key=createKey(new Uint8Array(32).fill(19));const data=encodeFunctionData({abi:poolAbi,functionName:'deposit',args:[`0x${'11'.repeat(32)}`]});
 const plan=atomicPlan(account,key,1n,paymaster,pool,data,100000000000000n),tx=signAtomic(plan,key),signature=tx.signatures[0]!.signature;
 expect(verifyAuthorization(key.publicKey,tx.sigHash(),signature)).toBe(true);
 for(const altered of [new FrameTx({...tx,nonceSeq:2}),new FrameTx({...tx,frames:[tx.frames[0]!,new Frame({...tx.frames[1]!,target:account}),tx.frames[2]!]}),new FrameTx({...tx,frames:[tx.frames[0]!,tx.frames[1]!,new Frame({...tx.frames[2]!,value:1})]})])expect(verifyAuthorization(key.publicKey,altered.sigHash(),signature)).toBe(false);
 expect(tx.frames.reduce((n,f)=>n+f.gasLimit+f.stateGasLimit,0n)).toBeLessThan(20000000n);
});
test('atomic notes reject historical formats, altered secrets and another pool',()=>{
 const n=createNote(pool,'100000000000000');expect(parseNote(JSON.stringify(n),pool,n.denominationWei)).toEqual(n);
 for(const changed of [{...n,kind:'qraft-pq-note'},{...n,secret:'1'},{...n,pool:account}])expect(()=>parseNote(JSON.stringify(changed),pool,n.denominationWei)).toThrow();
 const root=keccak256(bytesToHex(new Uint8Array(32)));const digest=withdrawalDigest(n,root,account,100n);
 expect(withdrawalDigest(n,root,account,101n)).not.toBe(digest);expect(withdrawalDigest(n,root,paymaster as Hex,100n)).not.toBe(digest);
});
