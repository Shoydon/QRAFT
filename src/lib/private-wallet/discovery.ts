import {decodeEventLog,encodeFunctionData,decodeFunctionResult,hexToBytes,numberToHex,type Hex} from 'viem';
import {privatePoolAbi} from './protocol';
import {PrivateTree} from './tree';
import {decryptNote,type PrivateKeys} from './crypto';
import {noteNullifier,type IndexedNote,type PoolDomain} from './model';
export interface PrivateRpc {request<T>(method:string,params?:unknown[]):Promise<T>;reconnect?():void}
export interface PoolOutput {commitment:bigint;index:number;envelope:Hex;blockNumber:bigint;transactionHash:Hex}
export interface PrivateSnapshot {tree:PrivateTree;notes:IndexedNote[];pendingNotes:IndexedNote[];spent:Set<string>;settlements:Map<Hex,Hex>;outputs:PoolOutput[];blockNumber:bigint;blockHash:Hex;timestamp:bigint;balance:bigint;pendingBalance:bigint}
export async function discoverPrivateWallet(rpc:PrivateRpc,domain:PoolDomain,keys:PrivateKeys,onProgress:(message:string)=>void=()=>{},fromBlock=0n,signal?:AbortSignal):Promise<PrivateSnapshot>{
 const active=()=>{if(signal?.aborted)throw Error('Wallet locked');};active();
 const head=await rpc.request<{number:Hex;hash:Hex;timestamp:Hex}>('eth_getBlockByNumber',['latest',false]);
 const blockNumber=BigInt(head.number),mature=blockNumber>1n?blockNumber-1n:0n,tree=new PrivateTree(),outputs:PoolOutput[]=[],spent=new Set<string>(),settlements=new Map<Hex,Hex>();
 for(let start=fromBlock;start<=blockNumber;start+=1000n){
  active();
  const end=start+999n<blockNumber?start+999n:blockNumber;
  onProgress(`Reading private pool history · block ${end}`);
  const logs=await rpc.request<{data:Hex;topics:Hex[];blockNumber:Hex;transactionHash:Hex;logIndex:Hex;removed?:boolean}[]>('eth_getLogs',[{address:domain.pool,fromBlock:numberToHex(start),toBlock:numberToHex(end)}]);
  logs.sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
  for(const log of logs){if(log.removed)throw Error('Chain changed while syncing. Refresh the private balance.');
   const decoded=decodeEventLog({abi:privatePoolAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});
   if(decoded.eventName==='Output'){
    const args=decoded.args;if(args.leafIndex!==tree.count)throw Error('Pool history is incomplete');
    tree.insert(args.commitment);if(tree.root()!==args.root)throw Error('Pool history root mismatch');
    outputs.push({commitment:args.commitment,index:args.leafIndex,envelope:args.envelope,blockNumber:BigInt(log.blockNumber),transactionHash:log.transactionHash});
   }else if(decoded.eventName==='Spent')spent.add(decoded.args.nullifier.toString());
   else if(decoded.eventName==='Settled')settlements.set(decoded.args.actionId,log.transactionHash);
  }
 }
 const call=await rpc.request<Hex>('eth_call',[{to:domain.pool,data:encodeFunctionData({abi:privatePoolAbi,functionName:'currentRoot'})},head.number]);
 const canonical=decodeFunctionResult({abi:privatePoolAbi,functionName:'currentRoot',data:call});if(canonical!==tree.root())throw Error('Private pool snapshot does not match the chain');
 const notes:IndexedNote[]=[],pendingNotes:IndexedNote[]=[];
 active();
 if(typeof Worker!=='undefined'){
  const found=await new Promise<(IndexedNote&{blockNumber:bigint})[]>((resolve,reject)=>{
   const worker=new Worker(new URL('./discovery.worker.ts',import.meta.url));
   const timer=setTimeout(()=>{worker.terminate();reject(Error('Private balance scan timed out'));},120000);
   const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();};
   const abort=()=>{stop();reject(Error('Wallet locked'));};signal?.addEventListener('abort',abort,{once:true});
   worker.onmessage=({data})=>{if(data.progress){onProgress(data.progress);return;}stop();if(data.error)reject(Error(data.error));else resolve(data.notes);};
   worker.onerror=()=>{stop();reject(Error('Private balance worker failed'));};
   worker.postMessage({domain,keys:{receiving:keys.receiving,owner:keys.owner,spendingSecret:keys.spendingSecret},outputs,spent:[...spent]});
  });
  for(const {blockNumber:height,...note} of found)(height<=mature?notes:pendingNotes).push(note);
 }else for(let i=0;i<outputs.length;i++){
  if(i%20===0)onProgress(`Finding your payments · ${i} of ${outputs.length}`);
  const output=outputs[i]!,note=await decryptNote(domain,keys,output.commitment,hexToBytes(output.envelope));
  if(note&&!spent.has(noteNullifier(keys.spendingSecret,note.commitment).toString()))(output.blockNumber<=mature?notes:pendingNotes).push({...note,index:output.index});
 }
 const check=await rpc.request<{hash:Hex}>('eth_getBlockByNumber',[head.number,false]);if(check.hash!==head.hash)throw Error('Chain reorganized during sync. Refresh to rebuild your balance.');
 active();
 return{tree,notes,pendingNotes,spent,settlements,outputs,blockNumber,blockHash:head.hash,timestamp:BigInt(head.timestamp),balance:notes.reduce((sum,n)=>sum+n.amount,0n),pendingBalance:pendingNotes.reduce((sum,n)=>sum+n.amount,0n)};
}
