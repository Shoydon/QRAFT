import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {encodeFunctionData,parseAbi,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import manifest from '../public/private-deployment.json';
import {Frame,FrameSig,FrameTx,assertSuccessfulReceipt} from '../packages/frame-account/src/frametx';
import {signServiceFrame} from '../src/lib/pq/service-frames';
import {submitToSidecar} from '../packages/frame-account/src/alt-mempool';
import type {PqRawReceipt} from '../src/lib/pq/account';
const root='.local/private-relayerless-setup';await mkdir(root,{recursive:true,mode:0o700});
const opFile='.local/alt-mempool-deployment/operator.json';if((await stat(opFile)).mode&0o077)throw Error('Unsafe operator key permissions');
const operator=privateKeyToAccount(JSON.parse(await readFile(opFile,'utf8')).privateKey);
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
const pin=(name:keyof typeof manifest.contracts)=>manifest.contracts[name].address as Hex;
const operations:[string,Hex,Hex,bigint][]=[
 ['initialize-proof',pin('proofAccount'),encodeFunctionData({abi:parseAbi(['function initialize(address)']),functionName:'initialize',args:[pin('paymaster')]}),0n],
 ['initialize-bootstrap',pin('bootstrap'),encodeFunctionData({abi:parseAbi(['function initialize(address,address,address,address)']),functionName:'initialize',args:[pin('factory'),pin('implementation'),pin('validator'),pin('paymaster')]}),0n],
 ['proof-stake',pin('proofAccount'),encodeFunctionData({abi:parseAbi(['function stake() payable']),functionName:'stake'}),12000000000000000n],
 ['bootstrap-stake',pin('bootstrap'),encodeFunctionData({abi:parseAbi(['function stake() payable']),functionName:'stake'}),12000000000000000n],
 ['sponsor-stake',pin('paymaster'),encodeFunctionData({abi:parseAbi(['function stake() payable']),functionName:'stake'}),12000000000000000n],
 ['sponsor-fund',pin('paymaster'),'0x',500000000000000000n],
 ['onboarding-fund',pin('bootstrap'),'0x',240000000000000000n],
];
for(const [name,to,data,value] of operations){
 const file=root+'/setup-'+name+'-'+to+'.json';let tx:{raw:Hex;hash:Hex};
 try{tx=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
 const nonce=BigInt(await rpc.request<Hex>('eth_getTransactionCount',[operator.address,'latest']));
 const plan=new FrameTx({chainId:1337,sender:operator.address,nonceKeys:[0],nonceSeq:nonce,maxFee:128,maxPriorityFee:1,signatures:[new FrameSig({scheme:1,signer:operator.address,signature:`0x${'00'.repeat(65)}`})],frames:[new Frame({mode:1,flags:3,target:operator.address,gasLimit:30000,stateGasLimit:97920}),new Frame({mode:2,target:to,data,value,gasLimit:2000000,stateGasLimit:8000000})]});const signed=signServiceFrame(plan,await operator.sign({hash:plan.sigHash()}));tx={raw:signed.raw(),hash:signed.transactionHash()};await writeFile(file,JSON.stringify(tx),{mode:0o600});}
 let receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[tx.hash]);
 if(!receipt){
  if(process.argv.includes('--execution-bootstrap')){
   const response=await fetch(manifest.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[tx.raw]})});const result=await response.json();if(result.error)throw Error(result.error.message);if(result.result!==tx.hash)throw Error('Bootstrap hash mismatch');
  }else await submitToSidecar(rpc,tx.raw);
 }
 for(let i=0;!receipt&&i<90;i++){await new Promise(r=>setTimeout(r,2000));receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[tx.hash]);}
 if(!receipt)throw Error('Pending '+name+' '+tx.hash);assertSuccessfulReceipt(receipt,2);console.log('Confirmed',name,tx.hash);
}
console.log('Relayerless infrastructure initialized, staked and funded.');
