/** Real native-frame verification. Setup keys remain in ignored mode-0600 files. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {encodeFunctionData,hexToBytes,bytesToHex,type Hex} from 'viem';
import manifest from '../public/private-deployment.json';
import {derivePrivateKeys,encodePrivateAddress,decodePrivateAddress,buildPrivateAction,privatePoolAbi} from '../src/lib/private-wallet/protocol';
import {discoverPrivateWallet} from '../src/lib/private-wallet/discovery';
import {deploymentDomain,type PrivateDeployment} from '../src/lib/private-wallet/deployment';
import {privateFramePlan} from '../src/lib/private-wallet/frames';
import {createKey,signAtomic,submitAtomic} from '../src/lib/atomic/account';
import {modularNonce} from '../src/lib/atomic/modular';
import {assertSuccessfulReceipt,type FrameSimulation} from '../packages/frame-account/src/frametx';
import type {PqRawReceipt} from '../src/lib/pq/account';
// snarkjs does not ship TypeScript declarations.
// @ts-expect-error untyped build dependency
import {groth16} from 'snarkjs';
const root='.local/private-live';await mkdir(root,{recursive:true,mode:0o700});
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(method.startsWith('ethrex_')?manifest.rpcUrl:manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
const domain=deploymentDomain(manifest as PrivateDeployment),carrier=JSON.parse(await readFile('.local/private-relay/carrier.json','utf8'));
let seeds:{alice:Hex;bob:Hex};try{seeds=JSON.parse(await readFile(root+'/keys.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;seeds={alice:bytesToHex(crypto.getRandomValues(new Uint8Array(32))),bob:bytesToHex(crypto.getRandomValues(new Uint8Array(32)))};await writeFile(root+'/keys.json',JSON.stringify(seeds),{mode:0o600});}
const alice=derivePrivateKeys(hexToBytes(seeds.alice)),bob=derivePrivateKeys(hexToBytes(seeds.bob));
const receiver=(keys:typeof alice)=>decodePrivateAddress(encodePrivateAddress(domain,keys),domain);
const results:unknown[]=[];
for(const step of ['shield','send','withdraw'] as const){
 const file=root+'/'+step+'.json';let saved:{hash:Hex;raw:Hex;expiry:string};
 try{saved=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
 const keys=step==='withdraw'?bob:alice,snapshot=await discoverPrivateWallet(rpc,domain,keys,()=>{},BigInt(manifest.fromBlock));
 if(step!=='shield'&&!snapshot.notes.length)throw Error('Waiting for mature input payments');
 const input=step==='shield'?[]:[snapshot.notes[0]!],amount=input.reduce((s,n)=>s+n.amount,0n);
 const built=await buildPrivateAction({domain,keys,tree:snapshot.tree,inputs:input,outputs:step==='shield'?[{recipient:receiver(alice),amount:10000n}]:step==='send'?[{recipient:receiver(bob),amount:6000n},{recipient:receiver(alice),amount:amount-6000n}]:[{recipient:receiver(bob),amount:amount-1000n}],kind:step==='shield'?0:step==='send'?1:2,deposit:step==='shield'?10000n:0n,withdrawal:step==='withdraw'?1000n:0n,recipient:step==='withdraw'?'0x0000000000000000000000000000000000001234':undefined,expiry:snapshot.timestamp+240n});
 const start=performance.now();const p=await groth16.fullProve(built.witness,'public/private-proving/join-split.wasm','public/private-proving/join-split.zkey',undefined,undefined,{singleThread:true});
 const words=(await groth16.exportSolidityCallData(p.proof,p.publicSignals)).match(/0x[0-9a-fA-F]+/g).slice(0,8).map(BigInt) as [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint];
 const key=createKey(hexToBytes(carrier.seed)),nonce=await modularNonce(rpc,carrier.address,manifest.contracts.validator.address as Hex);
 const data=encodeFunctionData({abi:privatePoolAbi,functionName:'transact',args:[built.action,words]});
 const tx=signAtomic(privateFramePlan(carrier.address,key,nonce,manifest.contracts.validator.address as Hex,manifest.contracts.paymaster.address as Hex,domain.pool,data,built.action.deposit),key);key.seed.fill(0);
 const simulation=await rpc.request<FrameSimulation>('ethrex_simulateFrameTransaction',[tx.raw(),'latest']);
 if(simulation.executionStatus!=='success'||simulation.frames?.some(f=>!f.succeeded))throw Error('Native simulation failed: '+JSON.stringify(simulation));
 console.log(step,'native simulation passed; proof ms',Math.round(performance.now()-start));
 saved={raw:tx.raw(),hash:tx.transactionHash(),expiry:String(built.action.expiry)};await writeFile(file,JSON.stringify(saved),{mode:0o600});
 }
 let receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[saved.hash]);
 if(!receipt){
  if(process.argv.includes('--execution-test')){
   const r=await fetch(manifest.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[saved.raw]})});const j=await r.json();if(j.error)throw Error(j.error.message);
   for(let i=0;i<30&&!receipt;i++){await new Promise(r=>setTimeout(r,2000));receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[saved.hash]);}
  }else receipt=(await submitAtomic(rpc,saved.raw,console.log)).receipt as PqRawReceipt;
 }
 if(!receipt)throw Error('Awaiting '+step+' '+saved.hash);assertSuccessfulReceipt(receipt,3);results.push({step,hash:saved.hash,gasUsed:String(BigInt(receipt.gasUsed)),payer:receipt.payer,frameStatuses:receipt.frameReceipts?.map(f=>f.status)});console.log('Confirmed',step,saved.hash);
 await new Promise(r=>setTimeout(r,12000));
}
await writeFile('docs/pq/private-pool-live.json',JSON.stringify({passed:true,route:process.argv.includes('--execution-test')?'explicit direct execution test':'alternative mempool',pool:domain.pool,results},null,2)+'\n');
