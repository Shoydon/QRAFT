/** Explicit direct-RPC integration test; browser anonymity is checked separately. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {bytesToHex,hexToBytes,encodeFunctionData,parseAbi,type Hex} from 'viem';
import {PqAccountClient,type PublicJournalStorage} from '../src/lib/pq/account';
import {provisionPqAccount} from '../src/lib/pq/service';
import {createPqNote,serializePqNote} from '../src/lib/pq/note';
import {DEFAULT_PQ_POOL} from '../src/lib/pq/registry';
import manifest from '../public/pq-deployment.json';
import type {ChainTransport} from '../src/lib/transport/types';
const root='.local/alt-mempool-integration';await mkdir(root,{recursive:true,mode:0o700});
const save=(name:string,value:unknown)=>writeFile(`${root}/${name}`,JSON.stringify(value,null,2),{mode:0o600});
let seed:Hex;
try{seed=JSON.parse(await readFile(`${root}/seed.json`,'utf8')).seed;}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='ENOENT')throw e;seed=bytesToHex(crypto.getRandomValues(new Uint8Array(32)));await save('seed.json',{seed});}
const transport:ChainTransport={start(){},stop(){},subscribe(){return()=>{};},getStatus(){return{phase:'ready',network:'Explicit direct test',detail:null,code:null,lastLatencyMs:0,requestCount:0};},async request<T>(method:string,params:unknown[]=[]):Promise<T>{
 const endpoint=method==='eth_sendFrameTransaction'||method.startsWith('skandha_')?'https://altmempool.forshtat.com/rpc':manifest.rpcUrl;
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;
}};
let records:Record<string,string>={};try{records=JSON.parse(await readFile(`${root}/journal.json`,'utf8'));}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='ENOENT')throw e;}
// synchronous journal writes persist signed intent before disclosure.
const {writeFileSync}=await import('node:fs');
const storage:PublicJournalStorage={getItem:k=>records[k]??null,setItem(k,v){records[k]=v;writeFileSync(`${root}/journal.json`,JSON.stringify(records),{mode:0o600});},removeItem(k){delete records[k];writeFileSync(`${root}/journal.json`,JSON.stringify(records),{mode:0o600});}};
const wallet=await PqAccountClient.create(transport,{seed:hexToBytes(seed),journalStorage:storage,withLock:async(_name,fn)=>fn(),onProgress:console.log,
 fetch:async(_input,init)=>new Response(JSON.stringify(await provisionPqAccount(JSON.parse(String(init?.body)).publicKey,async label=>{console.log(label);})),{headers:{'content-type':'application/json'}})});
await save('backup.json',JSON.parse(wallet.backup()));console.log('PQ account',wallet.address);
let note;try{note=JSON.parse(await readFile(`${root}/note.json`,'utf8'));}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='ENOENT')throw e;note=createPqNote(DEFAULT_PQ_POOL);await save('note.json',note);await writeFile(`${root}/note.txt`,serializePqNote(note),{mode:0o600});}
let previous;try{previous=JSON.parse(await readFile(`${root}/result.json`,'utf8'));}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='ENOENT')throw e;}
let result;
if(previous?.kind==='confirmed')result=previous;
else if(wallet.pending)result=await wallet.reconcile({onProgress:console.log});
else result=await wallet.send({to:manifest.pool as Hex,value:BigInt(manifest.denominationWei),data:encodeFunctionData({abi:parseAbi(['function deposit(bytes32[2] commitment) payable']),functionName:'deposit',args:[[note.commitment.slice(0,66),`0x${note.commitment.slice(66)}`] as [Hex,Hex]]}),onProgress:console.log});
console.log('result',JSON.stringify(result));
await save('result.json',result);
if(result.kind!=='confirmed')throw Error('PQ sidecar deposit did not confirm; preserve journal');
const admission=await transport.request('skandha_explorer_getTransaction',[result.hash]);
await save('evidence.json',{chainId:1337,scope:'Direct RPC integration; browser anonymity separate',account:wallet.address,paymaster:manifest.contracts.paymaster.address,result,admission});
