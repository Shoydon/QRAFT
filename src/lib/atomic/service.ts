import 'server-only';
import {mkdir,readFile,writeFile,open,unlink,stat,readdir} from 'node:fs/promises';
import {encodeFunctionData,encodeDeployData,encodeAbiParameters,getCreate2Address,keccak256,bytesToHex,hexToBytes,parseAbi,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import manifest from '../../../public/atomic-deployment.json';
import accountArtifact from '../../../packages/atomic/artifacts/AtomicAccount.json';
import {preparePublicKey} from '../../../packages/pq-account/src/keys';
import {Frame,FrameSig,FrameTx,assertSuccessfulReceipt} from '../../../packages/frame-account/src/frametx';
import {submitToSidecar} from '../../../packages/frame-account/src/alt-mempool';
import {signServiceFrame} from '../pq/service-frames';
import type {PqRawReceipt} from '../pq/account';
const root='.local/atomic-service';
const rpc={async request<T>(method:string,params:unknown[]=[]):Promise<T>{const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}};
async function operatorCall(id:string,to:Hex,data:Hex,value=0n){
 const file=root+'/'+id+'.json';const keyFile=process.env.ATOMIC_OPERATOR_FILE??'.local/alt-mempool-deployment/operator.json';
 if((await stat(/* turbopackIgnore: true */ keyFile)).mode&0o077)throw Error('Operator file must have private permissions');
 const secret=JSON.parse(await readFile(/* turbopackIgnore: true */ keyFile,'utf8'));if(secret.chainId!==1337)throw Error('Wrong operator network');
 const operator=privateKeyToAccount(secret.privateKey);
 let record:{raw:Hex;hash:Hex};
 try{record=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
 // Do not sign a second intent against the nonce of an unconfirmed operation.
 for(const name of await readdir(root))if(name.endsWith('.json')){
 const previous=JSON.parse(await readFile(root+'/'+name,'utf8')) as {hash:Hex};
 if(!await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[previous.hash]))throw Error('A prior deployment is awaiting confirmation. Retry it before creating another wallet.');
 }
 const nonce=BigInt(await rpc.request<Hex>('eth_getTransactionCount',[operator.address,'latest']));
 const plan=new FrameTx({chainId:1337,sender:operator.address,nonceKeys:[0],nonceSeq:nonce,maxFee:128,maxPriorityFee:1,signatures:[new FrameSig({scheme:1,signer:operator.address,signature:`0x${'00'.repeat(65)}`})],frames:[new Frame({mode:1,flags:3,target:operator.address,gasLimit:30000,stateGasLimit:97920}),new Frame({mode:2,target:to,gasLimit:2000000,stateGasLimit:8000000,data,value})]});
 const tx=signServiceFrame(plan,await operator.sign({hash:plan.sigHash()}));record={raw:tx.raw(),hash:tx.transactionHash()};await writeFile(file,JSON.stringify(record),{mode:0o600});}
 for(let i=0;i<90;i++){
 const receipt=await rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[record.hash]);if(receipt){assertSuccessfulReceipt(receipt,2);return record.hash;}
 if(i===0||i%15===0)await submitToSidecar(rpc,record.raw);
 await new Promise(r=>setTimeout(r,2000));
 }throw Error('Wallet deployment is pending. Retry to check the same transaction.');
}
export async function provisionAtomicWallet(publicKey:Hex){
 if(!/^0x[0-9a-fA-F]{2624}$/.test(publicKey))throw Error('Invalid ML-DSA public key');
 const commitment=keccak256(bytesToHex(preparePublicKey(hexToBytes(publicKey)).subarray(1)));
 const factory=manifest.contracts.factory.address as Hex;
 const salt=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'}],[commitment,commitment]));
 const bytecode=encodeDeployData({abi:accountArtifact.abi,bytecode:accountArtifact.bytecode as Hex,args:[manifest.contracts.walletVerifier.address,commitment]});
 const address=getCreate2Address({from:factory,salt,bytecode});
 await mkdir(root,{recursive:true,mode:0o700});
 const lock=await open(root+'/operator.lock','wx',0o600).catch(()=>{throw Error('Another wallet is being deployed. Please retry shortly.');});
 try{
 const hash=await operatorCall(commitment.slice(2)+'-create',factory,encodeFunctionData({abi:parseAbi(['function create(bytes32 commitment,bytes32 salt) returns(address)']),functionName:'create',args:[commitment,commitment]}));
 await operatorCall(commitment.slice(2)+'-stake',address,encodeFunctionData({abi:parseAbi(['function stakeForAltMempool() payable']),functionName:'stakeForAltMempool'}),12000000000000000n);
 return{address,hash};
 }finally{await lock.close();await unlink(root+'/operator.lock');}
}
