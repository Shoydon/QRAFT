import { createPublicClient, custom, parseAbi, encodeFunctionData, decodeAbiParameters, decodeEventLog, concat, type Abi, type AbiParameter, type Hex } from 'viem';
import manifest from '../../../public/pq-deployment.json';
import abis from '../../../public/pq-v5/abis.json';
import type { ChainTransport } from '../transport/types';
import { verifyPqDeployment, type PqAccountClient, type PqSendResult } from './account';
import { PqNoteTree, parsePqNote, splitDigest, type PqDeployment, type PqNote } from './note';
import { browserPqProof, withdrawalContext, type PublicWithdrawalStatement } from './proof';
import { assertSuccessfulReceipt, decodeFrameTransaction } from '../../../packages/frame-account/src/frametx';
import type { PqRawReceipt } from './account';

export const PQ_DEPLOYMENT:PqDeployment={chainId:manifest.chainId,genesisHash:manifest.genesisHash as Hex,pool:manifest.pool as Hex,denominationWei:manifest.denominationWei};
export const pqPoolAbi=parseAbi([
 'function deposit(bytes32[2] commitment) payable returns(uint32)',
 'function currentRoot() view returns(bytes32[2])',
 'function isSpent(bytes32[2] nullifier) view returns(bool)',
 'function withdrawalContext(address recipient,address relayer,uint128 fee,uint64 deadline) view returns(bytes32[2])',
 'function withdraw(bytes32[2] root,bytes32[2] nullifier,address recipient,address relayer,uint128 fee,uint64 deadline,bytes32 sessionId)',
 'event Deposit(bytes32 commitmentHi,bytes32 commitmentLo,uint32 indexed index,bytes32 rootHi,bytes32 rootLo)',
 'event Withdrawal(bytes32 nullifierHi,bytes32 nullifierLo,address indexed recipient,address indexed relayer,uint128 fee,bytes32 sessionId)',
]);
const ZERO='0x0000000000000000000000000000000000000000' as const;
const openedAbi=parseAbi(['event Opened(bytes32 indexed id,address indexed consumer,address indexed opener)']);
interface ProofJob{id:string;phase:string;stage:string;claimsBlob?:string;material?:Hex;done?:number;error?:string;}
export interface PreparedPqWithdrawal{jobId:string;note:PqNote;recipient:Hex;deadline:bigint;statement:PublicWithdrawalStatement;signal:AbortSignal;}
export class PqIntentError extends Error{constructor(readonly result:PqSendResult){super('reason'in result?result.reason:'The native transaction did not confirm.');}}
interface Flow{owner:Hex;binding:string;nullifier:Hex;recipient:Hex;deadline:string;sessionId?:Hex;attached:boolean;pending?:'open'|'attach'|'withdraw';pendingHash?:Hex;result?:PqSendResult;}
const FLOW_PREFIX='qraft:pq:public-flow:v1:';
export class PqPoolClient{
 private readonly client;
 private verified:Promise<void>|null=null;
 private readonly flows=new Map<string,Flow>();
 constructor(readonly transport:ChainTransport){this.client=createPublicClient({cacheTime:0,transport:custom({request:({method,params})=>transport.request(method,params as unknown[]|undefined)},{retryCount:0})});}
 private async check(){if(!this.verified){this.verified=verifyPqDeployment(this.transport);this.verified.catch(()=>{this.verified=null;});}await this.verified;}
 async snapshot(){
  await this.check();const block=await this.client.getBlock();const tree=new PqNoteTree();const indices=new Map<string,{index:number;block:number}>();let withdrawals=0;
  for(let fromBlock=BigInt(manifest.deploymentBlock);fromBlock<=block.number;fromBlock+=20000n){
   const toBlock=fromBlock+19999n>block.number?block.number:fromBlock+19999n;
   const logs=await this.client.getLogs({address:PQ_DEPLOYMENT.pool,events:[pqPoolAbi[5],pqPoolAbi[6]],fromBlock,toBlock,strict:true});
   for(const log of logs.sort((a,b)=>Number(a.blockNumber-b.blockNumber)||a.logIndex-b.logIndex)){
    if(log.removed)throw Error('The PQ deposit history changed. Retry the read.');
    if(log.eventName==='Deposit'){
     const args=log.args as {commitmentHi:Hex;commitmentLo:Hex;index:number;rootHi:Hex;rootLo:Hex};
     if(args.index!==tree.leaves.length)throw Error('The RPC returned incomplete PQ note history.');
     const commitment=concat([args.commitmentHi,args.commitmentLo]);tree.insert(commitment);
     if(tree.root().toLowerCase()!==concat([args.rootHi,args.rootLo]).toLowerCase())throw Error('PQ note history does not match its authenticated root.');
     indices.set(commitment.toLowerCase(),{index:args.index,block:Number(log.blockNumber)});
    }else if(log.eventName==='Withdrawal')withdrawals++;
   }
  }
  const root=await this.client.readContract({address:PQ_DEPLOYMENT.pool,abi:pqPoolAbi,functionName:'currentRoot',blockNumber:block.number});
  if(tree.root().toLowerCase()!==concat(root).toLowerCase())throw Error('The RPC pool root differs from the authenticated deposit history. Retry the read; nothing was submitted.');
  if((await this.client.getBlock({blockNumber:block.number})).hash!==block.hash)throw Error('The RPC snapshot block changed during the read. Retry the read; nothing was submitted.');
  return{tree,indices,block,unspent:tree.leaves.length-withdrawals};
 }
 async noteStatus(note:PqNote){
  if(note.pool.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase()||note.chainId!==PQ_DEPLOYMENT.chainId||note.genesisHash!==PQ_DEPLOYMENT.genesisHash)throw Error('This PQ note belongs to another deployment.');
  const s=await this.snapshot();
  const spent=await this.client.readContract({address:PQ_DEPLOYMENT.pool,abi:pqPoolAbi,functionName:'isSpent',args:[splitDigest(note.nullifier)],blockNumber:s.block.number});
  return{...s,spent,leaf:s.indices.get(note.commitment.toLowerCase())??null};
 }
 parseNote(text:string){return parsePqNote(text,PQ_DEPLOYMENT);}
 private saveFlow(id:string,flow:Flow){if(typeof window!=='undefined')window.localStorage.setItem(FLOW_PREFIX+id,JSON.stringify(flow));}
 private loadFlow(id:string):Flow|undefined{if(typeof window==='undefined')return undefined;const raw=window.localStorage.getItem(FLOW_PREFIX+id);return raw?JSON.parse(raw) as Flow:undefined;}
 async restorePrepared(note:PqNote,signal:AbortSignal):Promise<PreparedPqWithdrawal|null>{
  if(typeof window==='undefined')return null;
  for(let i=window.localStorage.length-1;i>=0;i--){const key=window.localStorage.key(i);if(!key?.startsWith(FLOW_PREFIX))continue;const id=key.slice(FLOW_PREFIX.length);const flow=this.loadFlow(id);if(!flow||flow.result?.kind==='confirmed'||flow.nullifier.toLowerCase()!==note.nullifier.toLowerCase())continue;
   if(!flow.pending&&BigInt(flow.deadline)<(await this.client.getBlock()).timestamp)continue;
   const job=await this.job(`/${id}`,{signal});const statement=(job as unknown as {statement:PublicWithdrawalStatement}).statement;
   if(!statement||bytesToDigest(statement.nullifier).toLowerCase()!==note.nullifier.toLowerCase()||statement.publicContext.poolHex.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase()||statement.publicContext.recipientHex.toLowerCase()!==flow.recipient.toLowerCase()||statement.publicContext.deadline!==flow.deadline)throw Error('Saved public workflow does not match this note.');
   return{jobId:id,note,recipient:flow.recipient,deadline:BigInt(flow.deadline),statement,signal};
  }return null;
 }
 async deposit(account:PqAccountClient,note:PqNote,onProgress:(label:string)=>void,signal?:AbortSignal){
  await this.check();if(note.pool.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase()||note.denominationWei!==PQ_DEPLOYMENT.denominationWei)throw Error('Wrong PQ pool.');
  signal?.throwIfAborted();return this.confirmDeposit(await account.send({to:PQ_DEPLOYMENT.pool,data:encodeFunctionData({abi:pqPoolAbi,functionName:'deposit',args:[splitDigest(note.commitment)]}),value:BigInt(PQ_DEPLOYMENT.denominationWei),onProgress,signal}),note);
 }
 confirmDeposit(result:PqSendResult,note:PqNote):PqSendResult{
  if(result.kind!=='confirmed')return result;
  const [hi,lo]=splitDigest(note.commitment);
  const matched=result.receipt.logs.some(log=>{
   if(log.address.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase())return false;
   try{const event=decodeEventLog({abi:pqPoolAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});return event.eventName==='Deposit'&&event.args.commitmentHi.toLowerCase()===hi.toLowerCase()&&event.args.commitmentLo.toLowerCase()===lo.toLowerCase();}catch{return false;}
  });
  if(!matched)throw Error('The native receipt does not establish this exact PQ deposit.');return result;
 }
 async reconcileDeposit(account:PqAccountClient,note:PqNote,expectedHash:Hex|undefined,onProgress:(label:string)=>void,signal?:AbortSignal){
  const pending=account.pending;
  if(!pending||(expectedHash&&pending.hash.toLowerCase()!==expectedHash.toLowerCase()))throw Error('The frozen deposit intent is no longer pending. Import the saved note to check its deposit; do not reconcile another transaction here.');
  const execution=decodeFrameTransaction(pending.raw).frames[1];
  const data=encodeFunctionData({abi:pqPoolAbi,functionName:'deposit',args:[splitDigest(note.commitment)]});
  if(!execution||execution.target?.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase()||execution.data.toLowerCase()!==data.toLowerCase()||execution.value!==BigInt(PQ_DEPLOYMENT.denominationWei))throw Error('Another native intent is pending. Reconcile it in its original workflow.');
  return this.confirmDeposit(await account.reconcile({onProgress,signal,expectedHash:pending.hash}),note);
 }
 private async job(path:string,init?:RequestInit):Promise<ProofJob>{const response=await fetch(`/api/pq/proofs${path}`,init);const result=await response.json() as ProofJob;if(!response.ok||result.error)throw Error(result.error??'The local public-proof helper is unavailable.');return result;}
 private async waitJob(id:string,phases:string[],onProgress:(label:string)=>void,signal:AbortSignal){
  for(;;){signal.throwIfAborted();const job=await this.job(`/${id}`,{signal});onProgress(job.stage);if(job.phase==='failed')throw Error(job.error??'The public verifier stopped. Keep your note and proof journal.');if(phases.includes(job.phase))return job;await new Promise<void>(resolve=>setTimeout(resolve,1500));}
 }
 async prepare(note:PqNote,recipient:Hex,onProgress:(label:string)=>void,signal:AbortSignal):Promise<PreparedPqWithdrawal>{
  const status=await this.noteStatus(note);signal.throwIfAborted();if(status.spent)throw Error('This PQ note has already been withdrawn.');if(!status.leaf)throw Error('This PQ note has no confirmed deposit.');
  const deadline=status.block.timestamp+86400n;const context=withdrawalContext(recipient,deadline);
  const live=await this.client.readContract({address:PQ_DEPLOYMENT.pool,abi:pqPoolAbi,functionName:'withdrawalContext',args:[recipient,ZERO,0n,deadline]});
  if(concat(live).toLowerCase()!==context.digest.toLowerCase())throw Error('The withdrawal context does not match the PQ pool.');
  const {proof,statement}=await browserPqProof(note,status.tree,status.leaf.index,recipient,deadline,onProgress,signal);
  signal.throwIfAborted();onProgress('Encoding the public proof; your secret stays on this device');
  const uploaded=await this.job('',{method:'POST',headers:{'content-type':'application/octet-stream','x-qraft-public-statement':JSON.stringify(statement)},body:new Uint8Array(proof).buffer,signal});proof.fill(0);
  await this.waitJob(uploaded.id,['ready','uploaded'],onProgress,signal);
  await this.job(`/${uploaded.id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'upload'}),signal});
  await this.waitJob(uploaded.id,['uploaded'],onProgress,signal);
  return{jobId:uploaded.id,note,recipient,deadline,statement,signal};
 }
 private openId(result:PqSendResult):Hex{
  if(result.kind!=='confirmed')throw new PqIntentError(result);
  const logs=(result.receipt as unknown as {logs:{address:Hex;data:Hex;topics:[Hex,...Hex[]]}[]}).logs;
  for(const log of logs??[])if(log.address.toLowerCase()===manifest.contracts.session.address.toLowerCase())try{
   const decoded=decodeEventLog({abi:openedAbi,data:log.data,topics:log.topics});if(decoded.args.consumer.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase()||decoded.args.opener.toLowerCase()!==result.receipt.from.toLowerCase())throw Error('Wrong native proof session binding.');return decoded.args.id;
  }catch{/* Other session events do not identify this opening. */}
  throw Error('The native receipt did not identify a proof session.');
 }
 private async workflowReceipt(flow:Flow):Promise<PqSendResult>{
  if(!flow.pendingHash)return{kind:'not-sent',reason:'No frozen native hash is available; inspect the saved workflow before retrying.'};
  const receipt=await this.transport.request<PqRawReceipt|null>('eth_getTransactionReceipt',[flow.pendingHash]);
  if(!receipt)return{kind:'unknown',hash:flow.pendingHash,reason:'The saved workflow transaction remains unresolved.'};
  if(receipt.transactionHash.toLowerCase()!==flow.pendingHash.toLowerCase()||receipt.from.toLowerCase()!==flow.owner.toLowerCase()||receipt.payer?.toLowerCase()!==flow.owner.toLowerCase())throw Error('The saved workflow receipt has another binding.');
  const block=await this.transport.request<{hash:Hex}>('eth_getBlockByNumber',[receipt.blockNumber,false]);if(block.hash!==receipt.blockHash)throw Error('The saved workflow receipt is not canonical.');
  if(!Array.isArray(receipt.frameReceipts)||receipt.frameReceipts.length!==2||receipt.frameReceipts.some(frame=>!/^0x[01]$/.test(frame.status)))return{kind:'unknown',hash:flow.pendingHash,reason:'The saved native receipt is missing complete frame evidence.'};
  try{assertSuccessfulReceipt(receipt,2);return{kind:'confirmed',hash:flow.pendingHash,receipt};}catch{return{kind:'failed',hash:flow.pendingHash,receipt,reason:'The saved native workflow transaction reverted.'};}
 }
 private withdrawalReceipt(result:PqSendResult,prepared:PreparedPqWithdrawal,sessionId:Hex):PqSendResult{
  if(result.kind!=='confirmed')throw new PqIntentError(result);
  const matched=result.receipt.logs.some(log=>{
   if(log.address.toLowerCase()!==PQ_DEPLOYMENT.pool.toLowerCase())return false;
   try{const event=decodeEventLog({abi:pqPoolAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});
    return event.eventName==='Withdrawal'&&concat([event.args.nullifierHi,event.args.nullifierLo]).toLowerCase()===prepared.note.nullifier.toLowerCase()&&event.args.recipient.toLowerCase()===prepared.recipient.toLowerCase()&&event.args.relayer===ZERO&&event.args.fee===0n&&event.args.sessionId.toLowerCase()===sessionId.toLowerCase();
   }catch{return false;}
  });
  if(!matched)throw Error('The native receipt does not establish this exact PQ withdrawal.');return result;
 }
 async withdraw(account:PqAccountClient,prepared:PreparedPqWithdrawal,onProgress:(label:string)=>void):Promise<PqSendResult>{
  const {signal,jobId,note,recipient,deadline}=prepared;signal.throwIfAborted();await this.check();
  const binding=JSON.stringify([prepared.statement.root,prepared.statement.nullifier,prepared.statement.context,recipient,String(deadline)]);
  let flow=this.flows.get(jobId)??this.loadFlow(jobId);
  if(!flow)flow={owner:account.address,binding,nullifier:note.nullifier,recipient,deadline:String(deadline),attached:false};
  this.flows.set(jobId,flow);
  if(flow.binding!==binding||flow.owner.toLowerCase()!==account.address.toLowerCase())throw Error('Restore the PQ account that opened this exact proof session.');
  const session=manifest.contracts.session.address as Hex;
  const root=splitDigest(bytesToDigest(prepared.statement.root));const nul=splitDigest(note.nullifier);const ctx=splitDigest(bytesToDigest(prepared.statement.context));
  const stageCall=async(stage:'open'|'attach'|'withdraw')=>{
   if(stage==='open')return{to:session,data:encodeFunctionData({abi:abis.session as Abi,functionName:'openSession',args:[PQ_DEPLOYMENT.pool,root,nul,ctx]})};
   if(!flow.sessionId)throw Error('The frozen proof session is missing.');
   if(stage==='withdraw')return{to:PQ_DEPLOYMENT.pool,data:encodeFunctionData({abi:pqPoolAbi,functionName:'withdraw',args:[root,nul,recipient,ZERO,0n,deadline,flow.sessionId]})};
   const job=await this.job(`/${jobId}`,{signal});if(!job.material||!job.claimsBlob)throw Error('The public proof data is not ready.');
   const attach=(abis.session as Abi).find(item=>item.type==='function'&&item.name==='attachProof');if(!attach||attach.type!=='function')throw Error('Missing proof material ABI.');
   const[material]=decodeAbiParameters([attach.inputs[1] as AbiParameter],job.material);
   return{to:session,data:encodeFunctionData({abi:abis.session as Abi,functionName:'attachProof',args:[flow.sessionId,material,BigInt(job.claimsBlob)]})};
  };
  let expected:{to:Hex;data:Hex}|undefined;
  const ownIntent=()=>{
   const entry=account.pending;if(!entry||!expected)return null;
   const tx=decodeFrameTransaction(entry.raw);const execution=tx.frames[1];
   if(!execution||execution.target?.toLowerCase()!==expected.to.toLowerCase()||execution.data.toLowerCase()!==expected.data.toLowerCase()||execution.value!==0n)throw Error('Another native intent is pending. Reconcile it in its original workflow.');
   if(flow.pendingHash&&flow.pendingHash!==entry.hash)throw Error('The frozen workflow hash differs from the account intent.');
   return entry;
  };
  const notify=(label:string)=>{const entry=ownIntent();if(entry)flow.pendingHash=entry.hash;this.saveFlow(jobId,flow);onProgress(label);};
  const remember=(result:PqSendResult)=>{
   if('hash'in result){if(flow.pendingHash&&flow.pendingHash!==result.hash)throw Error('The native result changed the frozen workflow hash.');flow.pendingHash=result.hash;}
   if(result.kind!=='confirmed'){if(result.kind!=='unknown')flow.pending=undefined;this.saveFlow(jobId,flow);throw new PqIntentError(result);}
   return result;
  };
  if(flow.pending){
   expected=await stageCall(flow.pending);
   const entry=ownIntent();if(entry&&!flow.pendingHash){flow.pendingHash=entry.hash;this.saveFlow(jobId,flow);}
   const result=remember(entry?await account.reconcile({onProgress:notify,signal,expectedHash:entry.hash}):await this.workflowReceipt(flow));
   if(flow.pending==='open')flow.sessionId=this.openId(result);
   else if(flow.pending==='attach')flow.attached=true;
   else{this.withdrawalReceipt(result,prepared,flow.sessionId!);flow.result=result;flow.pending=undefined;this.saveFlow(jobId,flow);return result;}
   flow.pending=undefined;this.saveFlow(jobId,flow);
  }
  const sendStage=async(stage:'open'|'attach'|'withdraw')=>{
   if(account.pending)throw Error('Reconcile the other saved native intent before starting this stage.');
   expected=await stageCall(stage);flow.pending=stage;flow.pendingHash=undefined;this.saveFlow(jobId,flow);
   const result=await account.send({...expected,onProgress:notify,signal});
   const entry=ownIntent();if(entry)flow.pendingHash=entry.hash;
   return remember(result);
  };
  if(!flow.sessionId){const result=await sendStage('open');flow.sessionId=this.openId(result);flow.pending=undefined;this.saveFlow(jobId,flow);}
  if(!flow.attached){await sendStage('attach');flow.attached=true;flow.pending=undefined;this.saveFlow(jobId,flow);}
  await this.job(`/${jobId}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'verify',sessionId:flow.sessionId}),signal});
  await this.waitJob(jobId,['verified'],onProgress,signal);
  const progress=await this.client.readContract({address:session,abi:abis.session as Abi,functionName:'progress',args:[flow.sessionId]})as readonly bigint[];
  if(progress.map(String).join(',')!=='9,16,93,21,320,6080,12,0')throw Error('Anonymous reads have not confirmed the full PQ proof.');
  signal.throwIfAborted();const result=await sendStage('withdraw');this.withdrawalReceipt(result,prepared,flow.sessionId);flow.result=result;flow.pending=undefined;this.saveFlow(jobId,flow);return result;
 }

}
function bytesToDigest(bytes:number[]):Hex{if(bytes.length!==64)throw Error('Invalid public digest.');return`0x${bytes.map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;}
