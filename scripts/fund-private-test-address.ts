/** Devnet test faucet bootstrap: funds only the explicitly provided public address. */
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {isAddress,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import manifest from '../public/private-deployment.json';
import {Frame,FrameSig,FrameTx,assertSuccessfulReceipt} from '../packages/frame-account/src/frametx';
import {signServiceFrame} from '../src/lib/pq/service-frames';
import type {PqRawReceipt} from '../src/lib/pq/account';
const address=process.argv[2];if(!address||!isAddress(address))throw Error('Provide a test wallet public address');
const root='.local/private-browser';await mkdir(root,{recursive:true,mode:0o700});
const keyfile='.local/alt-mempool-deployment/operator.json';if((await stat(keyfile)).mode&0o077)throw Error('Unsafe operator key permissions');const operator=privateKeyToAccount(JSON.parse(await readFile(keyfile,'utf8')).privateKey);
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(manifest.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
const file=root+'/fund-'+address.toLowerCase()+'.json';let record:{raw:Hex;hash:Hex};
try{record=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const nonce=BigInt(await rpc.request<Hex>('eth_getTransactionCount',[operator.address,'latest']));const plan=new FrameTx({chainId:1337,sender:operator.address,nonceKeys:[0],nonceSeq:nonce,maxFee:128,maxPriorityFee:1,signatures:[new FrameSig({scheme:1,signer:operator.address,signature:`0x${'00'.repeat(65)}`})],frames:[new Frame({mode:1,flags:3,target:operator.address,gasLimit:30000,stateGasLimit:97920}),new Frame({mode:2,target:address,value:13000000000000000n,gasLimit:2000000,stateGasLimit:8000000})]});const tx=signServiceFrame(plan,await operator.sign({hash:plan.sigHash()}));record={raw:tx.raw(),hash:tx.transactionHash()};await writeFile(file,JSON.stringify(record),{mode:0o600});}
let receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[record.hash]);if(!receipt)await rpc.request('eth_sendRawTransaction',[record.raw]);for(let i=0;!receipt&&i<60;i++){await new Promise(r=>setTimeout(r,2000));receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[record.hash]);}if(!receipt)throw Error('Funding pending '+record.hash);assertSuccessfulReceipt(receipt,2);console.log('Test funding confirmed',record.hash);
