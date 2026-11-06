/** Direct-RPC differential test of deployed verifier builds. Uses public signed intent only. */
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,keccak256,stringToHex,hexToBytes,type Hex} from 'viem';
import {createKey,signAuthorization} from '../packages/pq-account/src/keys';
import {decodeFrameTransaction} from '../packages/frame-account/src/frametx';
const old='0x6248EF93Ab7072CB5c1Ac026F4Daeb97c700AE39';
const deployment=JSON.parse(await readFile('.local/alt-mempool-deployment/deployment.json','utf8'));
const current=deployment.contracts.mldsaVerifier.address as Hex;
const entries=JSON.parse(await readFile('.local/alt-mempool-integration/journal.json','utf8'));
const intent=JSON.parse(Object.values(entries)[0] as string);
const tx=decodeFrameTransaction(intent.raw);
const backup=JSON.parse(await readFile('.local/alt-mempool-integration/backup.json','utf8'));
const provisioned=JSON.parse(await readFile(`.local/pq-service-1337/${keccak256(backup.publicKey.toLowerCase())}.account.json`,'utf8'));
const descriptor=provisioned.descriptor;
if(!descriptor)throw Error('Missing public descriptor');
const rpc=createPublicClient({transport:http('https://altmempool.forshtat.com',{timeout:60000,retryCount:0})});
const abi=parseAbi(['function verify(address descriptor, bytes message, bytes signature) view returns(bool)']);
const evidence=[];
for(const address of [old,current] as Hex[]){
 const args=[descriptor,tx.sigHash(),intent.authorizationSignature] as const;
 const valid=await rpc.readContract({address,abi,functionName:'verify',args});if(!valid)throw Error('Valid signature rejected');
 const {encodeFunctionData}=await import('viem');
 const gas=await rpc.estimateGas({to:address,data:encodeFunctionData({abi,functionName:'verify',args})});
 const wrongMessage=('0x'+(tx.sigHash().slice(2,4)==='00'?'01':'00')+tx.sigHash().slice(4)) as Hex;
 const wrongSignature=('0x'+(intent.authorizationSignature.slice(2,4)==='00'?'01':'00')+intent.authorizationSignature.slice(4)) as Hex;
 for(const altered of [[descriptor,wrongMessage,intent.authorizationSignature],[descriptor,tx.sigHash(),wrongSignature]] as const){if(await rpc.readContract({address,abi,functionName:'verify',args:altered}))throw Error('Invalid signature accepted');}
 evidence.push({address,valid,mutationsRejected:2,estimatedGas:String(gas)});console.log(evidence.at(-1));
}
const key=createKey(hexToBytes(backup.seed));
for(let i=0;i<4;i++){
 const message=keccak256(stringToHex(`qraft verifier regression ${i}`));const signature=signAuthorization(key,message);
 for(const address of [old,current] as Hex[]){
  if(!await rpc.readContract({address,abi,functionName:'verify',args:[descriptor,message,signature]}))throw Error('Fresh regression signature rejected');
  if(await rpc.readContract({address,abi,functionName:'verify',args:[descriptor,keccak256(message),signature]}))throw Error('Changed message accepted');
 }
}
console.log('Four additional messages matched the original verifier; changed-message signatures rejected.');
await writeFile('docs/pq/verifier-gas-comparison.json',JSON.stringify(evidence,null,2)+'\n');
