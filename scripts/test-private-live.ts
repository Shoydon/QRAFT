/** Real native-frame verification. Setup keys remain in ignored mode-0600 files. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {encodeFunctionData,hexToBytes,bytesToHex,keccak256,parseAbi,type Hex} from 'viem';
import manifest from '../public/private-deployment.json';
import {derivePrivateKeys,encodePrivateAddress,decodePrivateAddress,buildPrivateAction,privatePoolAbi} from '../src/lib/private-wallet/protocol';
import {discoverPrivateWallet} from '../src/lib/private-wallet/discovery';
import {deploymentDomain,type PrivateDeployment} from '../src/lib/private-wallet/deployment';
import {privateFramePlan,privateProofFramePlan,privateFactoryPlan} from '../src/lib/private-wallet/frames';
import {createKey,preparePublicKey,signAtomic,submitAtomic} from '../src/lib/atomic/account';
import {modularNonce,predictModular} from '../src/lib/atomic/modular';
import {Frame,FrameTx,assertSuccessfulReceipt,type FrameSimulation} from '../packages/frame-account/src/frametx';
import type {PqRawReceipt} from '../src/lib/pq/account';
// snarkjs does not ship TypeScript declarations.
// @ts-expect-error untyped build dependency
import {groth16} from 'snarkjs';
const root='.local/private-direct-live/'+manifest.contracts.pool.address;await mkdir(root,{recursive:true,mode:0o700});
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(method.startsWith('ethrex_')?manifest.rpcUrl:manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
const domain=deploymentDomain(manifest as PrivateDeployment);
let seeds:{alice:Hex;bob:Hex};try{seeds=JSON.parse(await readFile(root+'/keys.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;seeds={alice:bytesToHex(crypto.getRandomValues(new Uint8Array(32))),bob:bytesToHex(crypto.getRandomValues(new Uint8Array(32)))};await writeFile(root+'/keys.json',JSON.stringify(seeds),{mode:0o600});}
const alice=derivePrivateKeys(hexToBytes(seeds.alice)),bob=derivePrivateKeys(hexToBytes(seeds.bob));
const receiver=(keys:typeof alice)=>decodePrivateAddress(encodePrivateAddress(domain,keys),domain);
const signing=createKey(alice.signingSeed),commitment=keccak256(bytesToHex(preparePublicKey(signing.publicKey).subarray(1)));
const publicAddress=predictModular(manifest.contracts.factory.address as Hex,manifest.contracts.implementation.address as Hex,manifest.contracts.validator.address as Hex,commitment);
let setupEvidence:unknown=null;
if(await rpc.request<Hex>('eth_getCode',[publicAddress,'latest'])==='0x'){
 const fund=Bun.spawn(['bun','scripts/fund-private-test-address.ts',publicAddress],{stdout:'inherit',stderr:'inherit'});if(await fund.exited!==0)throw Error('Test funding failed');
 const sponsorBefore=BigInt(await rpc.request<Hex>('eth_getBalance',[manifest.contracts.paymaster.address,'latest']));
 const fundedBalance=await rpc.request<Hex>('eth_getBalance',[publicAddress,'latest']);
 const setup=signAtomic(privateFactoryPlan(manifest.contracts.factory.address as Hex,signing,manifest.contracts.paymaster.address as Hex),signing);
 const simulation=await rpc.request<FrameSimulation>('ethrex_simulateFrameTransaction',[setup.raw(),'latest']);
 if(simulation.executionStatus!=='success'||simulation.frames?.some(f=>!f.succeeded))throw Error('Factory setup simulation failed: '+JSON.stringify(simulation));
 // Callers cannot withdraw setup funds directly or substitute another commitment.
 let rejected=false;try{await rpc.request('eth_call',[{to:manifest.contracts.paymaster.address,data:encodeFunctionData({abi:parseAbi(['function fundSetup(bytes32)']),functionName:'fundSetup',args:[commitment]})},'latest']);}catch{rejected=true;}if(!rejected)throw Error('Unauthorized setup funding accepted');
 const badSetup=signAtomic(new FrameTx({...setup,frames:setup.frames.map((f,i)=>i===2?new Frame({...f,data:encodeFunctionData({abi:parseAbi(['function create(bytes32)']),functionName:'create',args:[keccak256('0x1234')]})}):f)}),signing);
 let badRejected=false;try{const sim=await rpc.request<FrameSimulation>('ethrex_simulateFrameTransaction',[badSetup.raw(),'latest']);badRejected=sim.executionStatus!=='success'||!!sim.frames?.some(f=>!f.succeeded);}catch{badRejected=true;}if(!badRejected)throw Error('Wrong setup commitment accepted');
 console.log('Factory setup simulation passed; unauthorized funding and wrong commitment rejected');
 await submitAtomic(rpc,setup.raw(),console.log);if(await rpc.request<Hex>('eth_getBalance',[publicAddress,'latest'])!==fundedBalance)throw Error('Sponsored setup debited user balance');const sponsorAfter=BigInt(await rpc.request<Hex>('eth_getBalance',[manifest.contracts.paymaster.address,'latest']));if(sponsorBefore-sponsorAfter<12000000000000000n)throw Error('Paymaster did not fund account stake');
 if(BigInt(await rpc.request<Hex>('eth_getBalance',[manifest.contracts.factory.address,'latest']))!==0n)throw Error('Factory retained setup funds');
 const completed=await rpc.request<Hex>('eth_call',[{to:publicAddress,data:encodeFunctionData({abi:parseAbi(['function setupComplete() view returns(bool)']),functionName:'setupComplete'})},'latest']);if(BigInt(completed)!==1n)throw Error('Account stake not completed');
 const duplicate=signAtomic(privateFactoryPlan(manifest.contracts.factory.address as Hex,signing,manifest.contracts.paymaster.address as Hex,1n),signing);let duplicateRejected=false;try{const sim=await rpc.request<FrameSimulation>('ethrex_simulateFrameTransaction',[duplicate.raw(),'latest']);duplicateRejected=sim.executionStatus!=='success'||!!sim.frames?.some(f=>!f.succeeded);}catch{duplicateRejected=true;}if(!duplicateRejected)throw Error('Repeated setup accepted');
 setupEvidence={hash:setup.transactionHash(),factory:manifest.contracts.factory.address,account:publicAddress,stakeWei:'12000000000000000',paymasterDebitWei:String(sponsorBefore-sponsorAfter),userBalanceUnchanged:true,unauthorizedFundingRejected:true,wrongCommitmentRejected:true,repeatedSetupRejected:true};await writeFile(root+'/setup-evidence.json',JSON.stringify(setupEvidence,null,2));
 console.log('Factory deployment and paymaster-funded stake confirmed; user balance unchanged; repeated setup rejected',publicAddress);
}
if(!setupEvidence)setupEvidence=JSON.parse(await readFile(root+'/setup-evidence.json','utf8'));
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
 const nonce=step==='shield'?await modularNonce(rpc,publicAddress,manifest.contracts.validator.address as Hex):0n;
 const data=encodeFunctionData({abi:privatePoolAbi,functionName:'transact',args:[built.action,words]});
 const tx=step==='shield'?signAtomic(privateFramePlan(publicAddress,signing,nonce,manifest.contracts.validator.address as Hex,manifest.contracts.paymaster.address as Hex,domain.pool,data,built.action.deposit),signing):privateProofFramePlan(manifest.contracts.proofAccount.address as Hex,manifest.contracts.paymaster.address as Hex,domain.pool,data,await rpc.request<Hex>('eth_call',[{to:domain.pool,data:encodeFunctionData({abi:privatePoolAbi,functionName:'actionDigest',args:[built.action]})},'latest']));
 const simulation=await rpc.request<FrameSimulation>('ethrex_simulateFrameTransaction',[tx.raw(),'latest']);
 if(simulation.executionStatus!=='success'||simulation.frames?.some(f=>!f.succeeded))throw Error('Native simulation failed: '+JSON.stringify(simulation));
 if(step!=='shield'){
  const mutations=[new FrameTx({...tx,nonceSeq:1n}),new FrameTx({...tx,nonceKeys:[1n]}),new FrameTx({...tx,maxFee:127}),new FrameTx({...tx,frames:tx.frames.map((f,i)=>i===2?new Frame({...f,gasLimit:100000}):f)}),new FrameTx({...tx,frames:tx.frames.map((f,i)=>i===2?new Frame({...f,stateGasLimit:0}):f)}),new FrameTx({...tx,frames:tx.frames.map((f,i)=>i===1?new Frame({...f,target:domain.pool}):f)})];
  for(const bad of mutations){let failed=false;try{const sim=await rpc.request<FrameSimulation>('ethrex_simulateFrameTransaction',[bad.raw(),'latest']);failed=sim.executionStatus!=='success'||!!sim.executionError||!!sim.violation||!!sim.frames?.some(f=>!f.succeeded);}catch{failed=true;}if(!failed)throw Error('Unsafe mutated proof transaction accepted');}
  console.log('Rejected nonce, fee, gas, state and sponsor mutations');
 }
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
await writeFile('docs/pq/private-pool-direct-live.json',JSON.stringify({passed:true,route:process.argv.includes('--execution-test')?'explicit direct execution test':'alternative mempool',pool:domain.pool,setup:setupEvidence,results},null,2)+'\n');
