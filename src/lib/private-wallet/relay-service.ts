import 'server-only';
import {mkdir,readFile,writeFile,rename,stat,readdir} from 'node:fs/promises';
import {openSync,writeFileSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {encodeFunctionData,hexToBytes,type Hex} from 'viem';
import {createKey,signAtomic,submitAtomic} from '../atomic/account';
import {modularNonce} from '../atomic/modular';
import {privateFramePlan} from './frames';
import {actionDigest,privatePoolAbi} from './protocol';
import {parsePayment} from './wire';
import {deploymentDomain,type PrivateDeployment} from './deployment';
import type {PqRawReceipt} from '../pq/account';
const root='.local/private-relay';
interface Record {id:Hex;raw:Hex;hash:Hex;createdAt:string;expiry:string}
function carrierLock(){
 const file=root+'/carrier.lock';
 try{const previous=JSON.parse(readFileSync(file,'utf8')) as {pid:number};let dead=false;try{process.kill(previous.pid,0);}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH';}if(dead)unlinkSync(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Relay lock needs operator recovery');}
 let fd:number;try{fd=openSync(file,'wx',0o600);}catch{throw Error('Relay is submitting another payment. Retry this same payment shortly.');}
 writeFileSync(fd,JSON.stringify({pid:process.pid}));return()=>{closeSync(fd);unlinkSync(file);};
}
// Single-host devnet journal. Deploy this service on persistent disk; ephemeral
// function filesystems cannot safely coordinate the carrier's nonce.
export async function relayPrivatePayment(value:unknown){
 const {action,proof}=parsePayment(value);
 if(action.kind===0||action.deposit!==0n)throw Error('Shield from your own public wallet');
 const manifest=JSON.parse(await readFile('public/private-deployment.json','utf8')) as PrivateDeployment;
 const domain=deploymentDomain(manifest),id=actionDigest(domain,action);
 const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Relay RPC unavailable');const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
 await mkdir(root,{recursive:true,mode:0o700});
 const unlock=carrierLock();
 try{
  const block=await rpc.request<{timestamp:Hex}>('eth_getBlockByNumber',['latest',false]);
  const path=root+'/'+id.slice(2)+'.json';let record:Record;
  try{record=JSON.parse(await readFile(path,'utf8'));}catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   // A missing receipt is uncertainty, never permission to reuse its nonce.
   for(const file of await readdir(root))if(/^[a-f0-9]{64}\.json$/.test(file)){
    const previous=JSON.parse(await readFile(root+'/'+file,'utf8')) as Record;
    if(!await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[previous.hash])&&(!previous.expiry||BigInt(block.timestamp)<=BigInt(previous.expiry)+30n))throw Error('Relay has an unresolved submission. Retry later.');
   }
   if(action.expiry<=BigInt(block.timestamp)+10n)throw Error('Payment proof expired. Refresh your balance before preparing it again.');
   const file=root+'/carrier.json';if((await stat(file)).mode&0o077)throw Error('Relay key permissions are unsafe');
   const carrier=JSON.parse(await readFile(file,'utf8')) as {seed:Hex;address:Hex;pool:Hex};
   if(carrier.pool.toLowerCase()!==domain.pool.toLowerCase())throw Error('Relay belongs to another pool');
   const data=encodeFunctionData({abi:privatePoolAbi,functionName:'transact',args:[action,proof]});
   // Executes the actual verifier and all pool checks before sponsorship.
   // This pool authorizes with its proof, not msg.sender. An ordinary eth_call
   // from a contract address is rejected by this devnet's EIP-3607 check.
   await rpc.request('eth_call',[{to:domain.pool,data},'latest']);
   const key=createKey(hexToBytes(carrier.seed));
   try{
    const nonce=await modularNonce(rpc,carrier.address,manifest.contracts.validator.address);
    const signed=signAtomic(privateFramePlan(carrier.address,key,nonce,manifest.contracts.validator.address,manifest.contracts.paymaster.address,domain.pool,data),key);
    record={id,raw:signed.raw(),hash:signed.transactionHash(),createdAt:new Date().toISOString(),expiry:String(action.expiry)};
    await writeFile(path+'.tmp',JSON.stringify(record),{mode:0o600});await rename(path+'.tmp',path);
   }finally{key.seed.fill(0);}
  }
  const previousReceipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[record.hash]);
  if(!previousReceipt&&BigInt(block.timestamp)>action.expiry)throw Error('Payment proof expired. Refresh your balance before preparing it again.');
  const result=await submitAtomic(rpc,record.raw);
  return{id,hash:result.hash,status:'confirmed' as const};
 }finally{unlock();}
}
