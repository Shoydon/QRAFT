/* eslint-disable @typescript-eslint/no-explicit-any -- local live-test journal uses raw RPC receipt extensions. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {encodeFunctionData,parseAbi,keccak256,bytesToHex,type Hex,decodeEventLog} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {execFileSync} from 'node:child_process';
import {Frame,FrameSig,FrameTx,assertSuccessfulReceipt} from '../packages/frame-account/src/frametx';
import {submitToSidecar} from '../packages/frame-account/src/alt-mempool';
import {signServiceFrame} from '../src/lib/pq/service-frames';
import {createKey,preparePublicKey,signAtomic,submitAtomic,poolAbi} from '../src/lib/atomic/account';
import {modularConfig,modularPlan,modularNonce} from '../src/lib/atomic/modular';
import {createNote} from '../src/lib/atomic/note';
import {proofInput} from '../src/lib/atomic/proof';
import type {PqRawReceipt} from '../src/lib/pq/account';
const root='.local/modular-live';await mkdir(root,{recursive:true,mode:0o700});
const manifest=JSON.parse(await readFile('public/modular-deployment.json','utf8'));
const pin=(name:string)=>manifest.contracts[name].address as Hex;
const secret=JSON.parse(await readFile('.local/alt-mempool-deployment/operator.json','utf8'));const operator=privateKeyToAccount(secret.privateKey);
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
let journal:any;try{journal=JSON.parse(await readFile(root+'/journal.json','utf8'));}catch{journal={operations:{},wallets:[]};}
const save=()=>writeFile(root+'/journal.json',JSON.stringify(journal,null,2),{mode:0o600});
async function execute(name:string,to:Hex,data:Hex='0x',value=0n){
 let record=journal.operations[name];
 if(!record){const nonce=BigInt(await rpc.request<string>('eth_getTransactionCount',[operator.address,'latest']));const plan=new FrameTx({chainId:1337,sender:operator.address,nonceKeys:[0],nonceSeq:nonce,maxFee:128,maxPriorityFee:1,signatures:[new FrameSig({scheme:1,signer:operator.address,signature:`0x${'00'.repeat(65)}`})],frames:[new Frame({mode:1,flags:3,target:operator.address,gasLimit:30000,stateGasLimit:97920}),new Frame({mode:2,target:to,gasLimit:2000000,stateGasLimit:8000000,data,value})]});const tx=signServiceFrame(plan,await operator.sign({hash:plan.sigHash()}));record={raw:tx.raw(),hash:tx.transactionHash()};journal.operations[name]=record;await save();}
 let receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[record.hash]);
 if(!receipt)await submitToSidecar(rpc,record.raw);
 for(let i=0;!receipt&&i<120;i++){await Bun.sleep(2000);receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[record.hash]);}
 if(!receipt)throw Error('Pending '+name);assertSuccessfulReceipt(receipt,2);record.receipt=receipt;await save();console.log(name,record.hash);return receipt;
}
await execute('fundPaymaster-v2',pin('paymaster'),'0x',10000000000000000n);
await execute('stakePaymaster-v2',pin('paymaster'),encodeFunctionData({abi:parseAbi(['function stake() payable']),functionName:'stake'}),12000000000000000n);
const factory=JSON.parse(await readFile('packages/atomic/artifacts/ERC8286AccountFactory.json','utf8'));
for(let i=0;i<2;i++){
 let secrets;try{secrets=JSON.parse(await readFile(root+`/wallet-${i+1}.json`,'utf8'));}catch{const key=createKey();secrets={version:1,algorithm:'ML-DSA-44',chainId:1337,genesisHash:manifest.genesisHash,publicKey:bytesToHex(key.publicKey),seed:bytesToHex(key.seed),address:null};await writeFile(root+`/wallet-${i+1}.json`,JSON.stringify(secrets),{mode:0o600});}
 const key=createKey(Uint8Array.from(Buffer.from(secrets.seed.slice(2),'hex')));const commitment=keccak256(bytesToHex(preparePublicKey(key.publicKey).subarray(1)));
 const r=await execute('createWallet'+i,pin('factory'),encodeFunctionData({abi:factory.abi,functionName:'createAccount',args:[pin('implementation'),modularConfig(pin('validator'),commitment),commitment]}));
 const log=r.logs.find((l:any)=>l.address.toLowerCase()===pin('factory').toLowerCase());
 if(!log)throw Error('Missing account creation event');const event=decodeEventLog({abi:factory.abi,data:log.data,topics:log.topics as [Hex,...Hex[]]}) as any;secrets.address=event.args.account;
 await writeFile(root+`/wallet-${i+1}.json`,JSON.stringify(secrets),{mode:0o600});journal.wallets[i]=secrets.address;await save();
 await execute('stakeWallet'+i,secrets.address,encodeFunctionData({abi:parseAbi(['function stakeForAltMempool() payable']),functionName:'stakeForAltMempool'}),12000000000000000n);
 if(i===0)await execute('fundWallet'+i,secrets.address,'0x',BigInt(manifest.denominationWei));
}
let note;try{note=JSON.parse(await readFile(root+'/note.json','utf8'));}catch{note=createNote(pin('pool'),manifest.denominationWei);await writeFile(root+'/note.json',JSON.stringify(note),{mode:0o600});}
async function userTx(name:string,index:number,data:Hex,value=0n){
 let record=journal.operations[name];
 if(!record){const w=JSON.parse(await readFile(root+`/wallet-${index+1}.json`,'utf8'));const key=createKey(Uint8Array.from(Buffer.from(w.seed.slice(2),'hex')));const nonce=await modularNonce(rpc,w.address,pin('validator'));const tx=signAtomic(modularPlan(w.address,key,nonce,pin('validator'),pin('paymaster'),pin('pool'),data,value),key);record={raw:tx.raw(),hash:tx.transactionHash()};journal.operations[name]=record;await save();}
 const result=await submitAtomic(rpc,record.raw,console.log);record.receipt=result.receipt;await save();console.log(name,result.hash);return result;
}
await userTx('deposit',0,encodeFunctionData({abi:poolAbi,functionName:'deposit',args:[note.commitment]}),BigInt(manifest.denominationWei));
const recipient=journal.wallets[1] as Hex;
let proofRecord;try{proofRecord=JSON.parse(await readFile(root+'/proof.json','utf8'));}catch{
 const block=await rpc.request<{timestamp:Hex}>('eth_getBlockByNumber',['latest',false]);const expiry=BigInt(block.timestamp)+86400n;
 const {root:treeRoot,input}=await proofInput(rpc,note,recipient,expiry);
 const start=Date.now();const {words}=JSON.parse(execFileSync('node',['scripts/prove-atomic.mjs'],{input:JSON.stringify(input),encoding:'utf8'}));
 proofRecord={root:treeRoot,expiry:String(expiry),words,provingMs:Date.now()-start};await writeFile(root+'/proof.json',JSON.stringify(proofRecord),{mode:0o600});
}
if(!journal.withdrawalBefore){journal.withdrawalBefore=await rpc.request<Hex>('eth_getBalance',[recipient,'latest']);await save();}
const before=BigInt(journal.withdrawalBefore);
const withdrawal=await userTx('withdrawal',1,encodeFunctionData({abi:poolAbi,functionName:'withdraw',args:[proofRecord.root,note.nullifierHash,recipient,BigInt(proofRecord.expiry),proofRecord.words.map(BigInt) as any]}));
const after=BigInt(await rpc.request<Hex>('eth_getBalance',[recipient,'latest']));
assert.equal(after-before,BigInt(manifest.denominationWei));
await writeFile('docs/pq/modular-live.json',JSON.stringify({chainId:1337,sharedContracts:manifest.contracts,wallets:journal.wallets,deposit:journal.operations.deposit.receipt,withdrawal:withdrawal.receipt,recipientDeltaWei:String(after-before),provingMs:proofRecord.provingMs},null,2)+'\n');
console.log('FULL LIVE FLOW PASSED');await execute('fundBrowserWallet',journal.wallets[0],'0x',BigInt(manifest.denominationWei));
