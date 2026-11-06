import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,bytesToHex,encodeFunctionData,keccak256,stringToHex} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {shake256} from '@noble/hashes/sha3.js';
import {createKey,preparePublicKey,signAuthorization} from '../packages/pq-account/src/keys';
const port=18549;
const node=spawn('anvil',['--silent','--port',String(port),'--chain-id','1337'],{stdio:'ignore'});
const account=mnemonicToAccount('test test test test test test test test test test test junk');
const client=createPublicClient({transport:http('http://127.0.0.1:'+port)});
const wallet=createWalletClient({account,transport:http('http://127.0.0.1:'+port)});
try{
 for(let i=0;i<50;i++){try{await client.getChainId();break;}catch{await Bun.sleep(100);}}
 const deploy=async(name:string)=>{const artifact=JSON.parse(await readFile('packages/atomic/artifacts/'+name+'.json','utf8'));const hash=await wallet.deployContract({...artifact,chain:null});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return{address:r.contractAddress!,abi:artifact.abi};};
 const shake=await deploy('ShakeHarness');
 for(const length of [0,1,32,135,136,137,272,800,832])for(const out of [32,64,136,272]){
 const input=Uint8Array.from({length},(_,i)=>i%251);
 assert.equal(await client.readContract({...shake,functionName:'hash',args:[bytesToHex(input),BigInt(out)]}),bytesToHex(shake256(input,{dkLen:out})));
 }
 console.log('36 SHAKE differential vectors passed');
 const verifier=await deploy('MLDSA44Verifier');const gas=[];
 for(let i=0;i<3;i++){
 const key=createKey(new Uint8Array(32).fill(i+1));
 const pk=bytesToHex(preparePublicKey(key.publicKey).subarray(1));
 const message=keccak256(stringToHex('atomic differential '+i));const sig=signAuthorization(key,message);
 const args=[pk,message,sig];
 assert.equal(await client.readContract({...verifier,functionName:'verify',args}),true);
 gas.push(String(await client.estimateGas({to:verifier.address,data:encodeFunctionData({abi:verifier.abi,functionName:'verify',args})})));
 for(const altered of [[pk,keccak256(message),sig],[pk,message,'0x'+sig.slice(2,-2)],[pk.slice(0,-2),message,sig],['0x'+(pk.slice(2,4)==='00'?'01':'00')+pk.slice(4),message,sig]])assert.equal(await client.readContract({...verifier,functionName:'verify',args:altered}),false);
 }
 const evidence={shake256Vectors:36,validKeys:3,invalidCases:12,estimatedGas:gas,runtimeBytes:23730};
 await writeFile('docs/pq/atomic-verifier-test.json',JSON.stringify(evidence,null,2)+'\n');console.log(evidence);
}finally{node.kill('SIGTERM');}
