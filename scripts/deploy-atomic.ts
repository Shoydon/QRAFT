/** Explicit one-time native-frame infrastructure bootstrap on EF chain 1337.
 * Code deposits can exceed the sidecar transaction budget. App traffic must use the sidecar. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { concat, encodeDeployData, getCreate2Address, keccak256, stringToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Frame, FrameSig, FrameTx, assertSuccessfulReceipt, type FrameSimulation } from '../packages/frame-account/src/frametx';
import type { PqRawReceipt } from '../src/lib/pq/account';
import { ALT_MEMPOOL } from '../packages/frame-account/src/alt-mempool';
import { signServiceFrame, DEPLOYMENT_PROXY, DEPLOYMENT_PROXY_HASH } from '../src/lib/pq/service-frames';

const root='.local/atomic-deployment';await mkdir(root,{recursive:true,mode:0o700});
const keyPath='.local/alt-mempool-deployment/operator.json';
if((await stat(keyPath)).mode&0o077)throw Error('Operator key must be mode 0600');
const key=JSON.parse(await readFile(keyPath,'utf8'));if(key.chainId!==1337)throw Error('Wrong operator chain');
const account=privateKeyToAccount(key.privateKey);
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{
 const r=await fetch('https://altmempool.forshtat.com/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});
 const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;
}};
const execution={async request<T>(method:string,params:unknown[]=[]):Promise<T>{
 const r=await fetch(ALT_MEMPOOL.execution,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});
 const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;
}};
if(BigInt(await rpc.request<string>('eth_chainId'))!==1337n||(await rpc.request<{hash:Hex}>('eth_getBlockByNumber',['0x0',false])).hash!==ALT_MEMPOOL.genesisHash)throw Error('Devnet identity mismatch');
if(keccak256(await rpc.request<Hex>('eth_getCode',[DEPLOYMENT_PROXY,'latest']))!==DEPLOYMENT_PROXY_HASH)throw Error('Proxy changed');
interface Record { name:string; inputHash:Hex; raw:Hex; hash:Hex; address:Hex; receipt?:PqRawReceipt }
interface Pin { address:Hex; runtimeHash:Hex; transactionHash:Hex; block:string; initDataHash:Hex }
const file=`${root}/deployment.json`;let journal:{chainId:number;genesisHash:string;operator:Hex;contracts:{[key:string]:Pin};transactions:Record[]};
try{journal=JSON.parse(await readFile(file,'utf8'));}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='ENOENT')throw e;journal={chainId:1337,genesisHash:ALT_MEMPOOL.genesisHash,operator:account.address,contracts:{},transactions:[]};}
if(journal.genesisHash!==ALT_MEMPOOL.genesisHash||journal.operator!==account.address)throw Error('Journal identity mismatch');
const save=()=>writeFile(file,JSON.stringify(journal,null,2),{mode:0o600});
async function deploy(name:string,data:Hex){
 const salt=keccak256(stringToHex(`qraft:atomic:v1:${name}`));const predicted=getCreate2Address({from:DEPLOYMENT_PROXY,salt,bytecode:data});
 let record=journal.transactions.find((r)=>r.name===name&&r.inputHash===keccak256(data));
 if(record&&record.inputHash!==keccak256(data))throw Error('Deployment inputs changed; use a new deployment version');
 if(!record){
  const nonce=BigInt(await rpc.request<string>('eth_getTransactionCount',[account.address,'latest']));
  const plan=new FrameTx({chainId:1337,nonceSeq:nonce,nonceKeys:[0],sender:account.address,maxFee:128,maxPriorityFee:1,
   signatures:[new FrameSig({scheme:1,signer:account.address,signature:`0x${'00'.repeat(65)}`})],
   frames:[new Frame({mode:1,flags:3,target:account.address,gasLimit:30000}),new Frame({mode:2,target:DEPLOYMENT_PROXY,gasLimit:14500000,stateGasLimit:40000000,data:concat([salt,data])})]});
  const tx=signServiceFrame(plan,await account.sign({hash:plan.sigHash()}));
  const simulation=await execution.request<FrameSimulation>('ethrex_simulateFrameTransaction',[tx.raw(),'latest']);
  if(simulation.executionStatus!=='success'||simulation.frames?.some((f)=>!f.succeeded))throw Error(`Deployment simulation ${name}: ${JSON.stringify(simulation)}`);
  record={name,inputHash:keccak256(data),raw:tx.raw(),hash:tx.transactionHash(),address:predicted};journal.transactions.push(record);await save();
 }
 let receipt=await rpc.request<PqRawReceipt | null>('eth_getTransactionReceipt',[record.hash]);
 if(!receipt){console.log('Submitting',name,record.hash);const returned = await execution.request<Hex>('eth_sendRawTransaction',[record.raw]); if(returned!==record.hash)throw Error('Bootstrap hash mismatch');}
 const deadline=Date.now()+240000;
 while(!receipt&&Date.now()<deadline){await new Promise(r=>setTimeout(r,2000));receipt=await rpc.request<PqRawReceipt | null>('eth_getTransactionReceipt',[record.hash]);}
 if(!receipt)throw Error(`Waiting for ${name}: ${record.hash}`);assertSuccessfulReceipt(receipt,2);
 const runtime=await rpc.request<Hex>('eth_getCode',[predicted,'latest']);if(runtime==='0x')throw Error('Missing deployed code');
 journal.contracts[name]={address:predicted,runtimeHash:keccak256(runtime),transactionHash:record.hash,block:String(BigInt(receipt.blockNumber)),initDataHash:keccak256(data)};record.receipt=receipt;await save();console.log('Confirmed',name,predicted);return predicted;
}
const address=(name:string)=>journal.contracts[name]!.address as Hex;
const artifact=async(name:string)=>JSON.parse(await readFile(`packages/atomic/artifacts/${name}.json`,'utf8'));
const specs:[string,string,()=>unknown[]][]=[
 ['walletVerifier','MLDSA44Verifier',()=>[]],
 ['proofVerifier','SpendVerifierStock',()=>[]],
 ['pool','AtomicPool',()=>[address('proofVerifier'),100000000000000n]],
 ['factory','AtomicFactory',()=>[address('walletVerifier')]],
 ['paymaster','AtomicPaymaster',()=>[account.address,address('factory'),address('pool')]],
];
for(const [name,artifactName,args]of specs)await deploy(name,encodeDeployData({...await artifact(artifactName),args:args()}));
await writeFile('public/atomic-deployment.json',JSON.stringify({version:1,id:'qraft-atomic-1337-v1',chainId:1337,genesisHash:ALT_MEMPOOL.genesisHash,rpcUrl:ALT_MEMPOOL.execution,sidecarUrl:'https://altmempool.forshtat.com/rpc',explorerUrl:ALT_MEMPOOL.explorer,denominationWei:'100000000000000',proofProfile:'Groth16-BN254-development-setup',walletAlgorithm:'ML-DSA-44',contracts:journal.contracts},null,2)+'\n');
console.log('Five shared contracts deployed.');
