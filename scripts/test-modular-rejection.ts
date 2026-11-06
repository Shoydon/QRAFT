import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {hexToBytes,encodeFunctionData,type Hex} from 'viem';
import {createKey,signAtomic,poolAbi} from '../src/lib/atomic/account';
import {modularPlan,modularNonce} from '../src/lib/atomic/modular';
import type {FrameSimulation} from '../packages/frame-account/src/frametx';
const m=JSON.parse(await readFile('public/modular-deployment.json','utf8'));
const w=JSON.parse(await readFile('.local/modular-live/wallet-1.json','utf8'));
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(m.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
const key=createKey(hexToBytes(w.seed));const validator=m.contracts.validator.address as Hex;
const plan=modularPlan(w.address,key,await modularNonce(rpc,w.address,validator),validator,m.contracts.paymaster.address,m.contracts.pool.address,encodeFunctionData({abi:poolAbi,functionName:'deposit',args:[`0x${'ab'.repeat(32)}`]}),0n);
const invalid=await rpc.request<FrameSimulation & {failedFrameIndex:number}>('ethrex_simulateFrameTransaction',[plan.raw(),'latest']);
assert.equal(invalid.failedFrameIndex,0,'invalid signature fails account verification');
const valid=await rpc.request<FrameSimulation & {failedFrameIndex:number}>('ethrex_simulateFrameTransaction',[signAtomic(plan,key).raw(),'latest']);
assert.equal(valid.failedFrameIndex,1,'valid signature passes account and wrong deposit value fails sponsorship');

await writeFile('docs/pq/modular-rejection.json',JSON.stringify({passed:true,invalidSignatureRejected:true,validSignatureControlPassed:true,incorrectDepositValueNotSponsored:true},null,2)+'\n');console.log('ONCHAIN SIGNATURE AND SPONSOR REJECTION CHECKS PASSED');
