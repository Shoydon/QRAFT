import { PQ_POOLS } from './registry';
import { withCarrierLock } from './carrier-lock';
/** Local gas/provisioning service. It never receives a user's seed or witness.
 * Its classical test carrier is bootstrap/gas infrastructure, not custody authority.
 */
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, encodePacked, hexToBytes, bytesToHex, concat, keccak256, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { preparePublicKey, verifyAuthorization } from '../../../packages/pq-account/src/keys';
import { decodeFrameTransaction } from '../../../packages/frame-account/src/frametx';
import manifest from '../../../public/pq-deployment.json';
import { recoverProvisionedPqAccount, assertSponsoredPqTransaction } from './account';
import type { ChainTransport } from '../transport/types';

const root=resolve('.local/pq-service');
const chain=defineChain({id:8141,name:'Ethrex devnet',nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[manifest.rpcUrl]}}});
const client=createPublicClient({cacheTime:0,transport:httpTransport()});
function httpTransport(){
  // Imported statically via viem's standard transport below to keep all carrier requests server-side.
  return http(manifest.rpcUrl,{timeout:60000,retryCount:0});
}
import { http } from 'viem';
const factoryAbi=parseAbi(['function predict(address implementation,bytes args,bytes32 salt) view returns(address)','function createAccount(address implementation,bytes args,bytes32 salt) payable returns(address)']);
const accountAbi=parseAbi(['function cacheAuthorization(bytes32 sigHash,bytes signature)']);
export interface PublicPqAccount {
  publicKey:Hex;address:Hex;descriptor:Hex;descriptorRuntime:Hex;rows:{address:Hex;runtime:Hex}[];
  cloneArgs:Hex;salt:Hex;runtime:Hex;
}
export function serviceStatus():{enabled:boolean;reason:string|null}{
  if(!manifest.applicationEnabled)return{enabled:false,reason:'Wallet creation is paused until the QRAFT contracts are deployed and verified.'};
  if(process.env.QRAFT_LOCAL_PQ_SERVICE!=='1')return{enabled:false,reason:'The local account service is not enabled. Enable it to create a wallet.'};
  return{enabled:true,reason:null};
}
export function serviceEnabled():boolean{return serviceStatus().enabled;}
async function save(path:string,value:unknown){
  const file=await open(path+'.tmp','w',0o600);
  try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
  await rename(path+'.tmp',path);
}
async function load<T>(path:string):Promise<T|null>{try{return JSON.parse(await readFile(path,'utf8')) as T;}catch(e){if(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT')return null;throw e;}}
async function carrier(){
  if(!serviceEnabled())throw Error('Local PQ provisioning is not enabled.');
  const path=process.env.QRAFT_DEPLOYER_KEY_FILE??'.local/deployer.json';
  if((await stat(/* turbopackIgnore: true */ path)).mode&0o077)throw Error('The local test gas key must be protected.');
  const key=JSON.parse(await readFile(/* turbopackIgnore: true */ path,'utf8')) as {chainId:number;privateKey:Hex};
  if(key.chainId!==8141||await client.getChainId()!==8141||(await client.getBlock({blockNumber:0n})).hash!==manifest.genesisHash)throw Error('PQ test-chain identity mismatch.');
  return createWalletClient({account:privateKeyToAccount(key.privateKey),chain,transport:httpTransport()});
}
async function singleWriter<T>(fn:()=>Promise<T>,onWait?:()=>Promise<void>):Promise<T>{
  return withCarrierLock(root,fn,{onWait});
}
interface GasRecord{hash:Hex;raw:Hex;nonce:number;inputHash:Hex;chainId:number;}
export async function gasCall(label:string,data:Hex,to?:Hex,value=0n):Promise<Hex|null>{
  const wallet=await carrier();
  const operation=keccak256(bytesToHex(new TextEncoder().encode(label)));
  const file=join(root,`${operation}.json`);
  const inputHash=keccak256(concat([to??'0x',data,bytesToHex(new TextEncoder().encode(String(value)))]));
  let record=await load<GasRecord>(file);
  if(record&&record.inputHash!==inputHash)throw Error('Saved local gas operation differs from this request.');
  if(!record){
    const nonce=await client.getTransactionCount({address:wallet.account.address});
    if(nonce!==await client.getTransactionCount({address:wallet.account.address,blockTag:'pending'}))throw Error('Reconcile the local carrier’s pending transaction first.');
    const block=await client.getBlock();
    const request=await wallet.prepareTransactionRequest({...(to?{to}:{}),data,value,nonce,maxFeePerGas:(block.baseFeePerGas??7n)*2n+1n,maxPriorityFeePerGas:1n});
    const raw=await wallet.signTransaction(request);record={hash:keccak256(raw),raw,nonce,inputHash,chainId:8141};await save(file,record);
  }
  if(keccak256(record.raw)!==record.hash||record.chainId!==8141)throw Error('Invalid saved gas transaction.');
  let receipt=await client.getTransactionReceipt({hash:record.hash}).catch(e=>{if(e.name==='TransactionReceiptNotFoundError')return null;throw e;});
  if(!receipt){
    const known=await client.getTransaction({hash:record.hash}).catch(e=>{if(e.name==='TransactionNotFoundError')return null;throw e;});
    if(!known){
      if(await client.getTransactionCount({address:wallet.account.address})!==record.nonce)throw Error('The saved carrier nonce changed. Reconcile this hash before continuing.');
      await client.sendRawTransaction({serializedTransaction:record.raw});
    }
    receipt=await client.waitForTransactionReceipt({hash:record.hash,timeout:180000});
  }
  if(receipt.status!=='success')throw Error('The local gas operation reverted.');
  return receipt.contractAddress??null;
}

/** Fixed public verifier calls only; these grants cannot authorize a withdrawal. */
export async function runPublicProgram(label:string,calls:{to:Hex;data:Hex}[],progress:(done:number)=>Promise<void>):Promise<void>{
  const allowed=new Set([manifest.contracts.session.address.toLowerCase(),manifest.contracts.blobs.address.toLowerCase()]);
  if(calls.length>800||calls.some(call=>!allowed.has(call.to.toLowerCase())||call.data.length>250002))throw Error('Invalid public verification program.');
  await singleWriter(async()=>{
    const wallet=await carrier();const file=join(root,`${keccak256(bytesToHex(new TextEncoder().encode(label)))}.program.json`);
    const binding=keccak256(bytesToHex(new TextEncoder().encode(JSON.stringify(calls))));
    let journal=await load<{binding:Hex;from:Hex;records:GasRecord[]}>(file);
    if(journal&&(journal.binding!==binding||journal.from!==wallet.account.address))throw Error('Frozen public program differs.');
    journal??={binding,from:wallet.account.address,records:[]};
    for(let start=0;start<calls.length;start+=12){
      const end=Math.min(start+12,calls.length);
      if(journal.records.length<end){
        const nonce=await client.getTransactionCount({address:wallet.account.address});
        if(nonce!==await client.getTransactionCount({address:wallet.account.address,blockTag:'pending'}))throw Error('Reconcile pending public computation before planning another window.');
        const block=await client.getBlock();
        for(let i=journal.records.length;i<end;i++){
          const call=calls[i]!;const raw=await wallet.signTransaction({chainId:8141,type:'eip1559',nonce:nonce+i-start,to:call.to,data:call.data,value:0n,gas:16700000n,maxFeePerGas:(block.baseFeePerGas??7n)*2n+1n,maxPriorityFeePerGas:1n});
          journal.records.push({chainId:8141,nonce:nonce+i-start,raw,hash:keccak256(raw),inputHash:keccak256(call.data)});
          await save(file,journal);
        }
      }
      for(let i=start;i<end;i++){
        const record=journal.records[i]!;
        if(keccak256(record.raw)!==record.hash||record.inputHash!==keccak256(calls[i]!.data))throw Error('Invalid saved public operation.');
        const receipt=await client.getTransactionReceipt({hash:record.hash}).catch(e=>{if(e.name==='TransactionReceiptNotFoundError')return null;throw e;});
        if(!receipt){
          const known=await client.getTransaction({hash:record.hash}).catch(e=>{if(e.name==='TransactionNotFoundError')return null;throw e;});
          if(!known){const current=await client.getTransactionCount({address:wallet.account.address});if(current>record.nonce)throw Error('Unresolved public operation nonce changed.');await client.sendRawTransaction({serializedTransaction:record.raw});}
        }
      }
      for(let i=start;i<end;i++){
        const record=journal.records[i]!;const receipt=await client.waitForTransactionReceipt({hash:record.hash,timeout:180000});
        if(receipt.status!=='success')throw Error(`Public verifier step ${i+1} reverted. Keep the exact proof and journal.`);
        await progress(i+1);
      }
    }
  });
}

export async function runPublicCall(label:string,to:Hex,data:Hex):Promise<Hex>{
  return singleWriter(async()=>{
    const wallet=await carrier();await gasCall(label,data,to);
    const file=join(root,`${keccak256(bytesToHex(new TextEncoder().encode(label)))}.json`);
    const record=await load<GasRecord>(file);if(!record||wallet.account.address===to)throw Error('Invalid public operation record.');return record.hash;
  });
}
function rawInit(runtime:Hex):Hex{
  const size=((runtime.length-2)/2).toString(16).padStart(4,'0');
  return `0x61${size}61000f60003961${size}6000f3${runtime.slice(2)}`;
}
export async function provisionPqAccount(publicKey:Hex,onProgress:(label:string)=>Promise<void>=async()=>{}):Promise<PublicPqAccount>{
  if(!/^0x[0-9a-fA-F]{2624}$/.test(publicKey))throw Error('Expected a 1312-byte ML-DSA-44 public key.');
  publicKey=publicKey.toLowerCase() as Hex;
  const prepared=preparePublicKey(hexToBytes(publicKey));
  return singleWriter(async()=>{
    const keyId=keccak256(publicKey);const path=join(root,`${keyId}.account.json`);
    const prior=await load<PublicPqAccount>(path);
    if(prior){if(prior.publicKey!==publicKey||(await client.getCode({address:prior.address}))?.toLowerCase()!==prior.runtime.toLowerCase())throw Error('Saved PQ account changed.');return prior;}
    await carrier();
    for(const name of ['validator','implementation','factory'] as const){const pin=manifest.contracts[name];const code=await client.getCode({address:pin.address as Hex});if(!code||keccak256(code)!==pin.runtimeHash)throw Error('PQ account infrastructure code changed.');}
    const rows:PublicPqAccount['rows']=[];
    for(let i=0;i<4;i++){
      await onProgress(`Deploying public key row ${i+1} of 4`);
      const runtime=bytesToHex(new Uint8Array([0,...prepared.slice(4161+i*4096,4161+(i+1)*4096),...prepared.slice(65+i*1024,65+(i+1)*1024)]));
      const address=await gasCall(`${keyId}:row:${i}`,rawInit(runtime));if(!address)throw Error('Missing public-key row deployment.');
      rows.push({address,runtime});
    }
    const descriptorRuntime=concat(['0x00',bytesToHex(prepared.slice(1,65)),...rows.flatMap(row=>[row.address,keccak256(row.runtime)])]);
    await onProgress('Deploying the public key descriptor');
    const descriptor=await gasCall(`${keyId}:descriptor`,rawInit(descriptorRuntime));if(!descriptor)throw Error('Missing public-key descriptor.');
    const cloneArgs=encodePacked(['address','uint8','uint8','uint8','address','bytes32'],[manifest.contracts.validator.address as Hex,2,15,0,descriptor,keccak256(descriptorRuntime)]);
    const salt=keyId;
    const address=await client.readContract({address:manifest.contracts.factory.address as Hex,abi:factoryAbi,functionName:'predict',args:[manifest.contracts.implementation.address as Hex,cloneArgs,salt]});
    const runtime=concat(['0x363d3d373d3d3d363d73',manifest.contracts.implementation.address as Hex,'0x5af43d82803e903d91602b57fd5bf3',cloneArgs]);
    await onProgress('Deploying your smart account');
    await gasCall(`${keyId}:account`,encodeFunctionData({abi:factoryAbi,functionName:'createAccount',args:[manifest.contracts.implementation.address as Hex,cloneArgs,salt]}),manifest.contracts.factory.address as Hex);
    if((await client.getCode({address}))?.toLowerCase()!==runtime.toLowerCase())throw Error('PQ account runtime/configuration mismatch.');
    await onProgress('Funding the devnet deposit balance');
    await gasCall(`${keyId}:test-principal`, '0x', address, 100000000000000n);
    const result={publicKey,address,descriptor,descriptorRuntime,rows,cloneArgs,salt,runtime};await save(path,result);return result;
  },()=>onProgress('Waiting for the local account deployment queue'));
}

interface AccountJob {id:Hex;publicKey:Hex;status:'provisioning'|'ready'|'failed';stage:string;ownerPid:number;updatedAt:number;account?:PublicPqAccount;error?:string;}
const accountJobs=new Map<string,AccountJob>();
let accountQueue=Promise.resolve();
function accountJobPath(id:string){if(!/^0x[0-9a-f]{64}$/.test(id))throw Error('Invalid account setup ID.');return join(root,`${id}.setup.json`);}
export async function accountProvisioningJob(id:string):Promise<AccountJob>{
  const job=await load<AccountJob>(accountJobPath(id));if(!job)throw Error('Account setup was not found. Retry with the same wallet.');
  if(job.status==='provisioning'){
    let alive=true;try{process.kill(job.ownerPid,0);}catch{alive=false;}
    if(!alive){job.status='failed';job.error='Account setup was interrupted. Retry to resume the same account.';await save(accountJobPath(id),job);}
  }
  return job;
}
export async function startAccountProvisioning(publicKey:Hex):Promise<AccountJob>{
  if(!serviceEnabled())throw Error(serviceStatus().reason??'Account creation is unavailable.');
  if(!/^0x[0-9a-fA-F]{2624}$/.test(publicKey))throw Error('Expected a 1312-byte ML-DSA-44 public key.');
  publicKey=publicKey.toLowerCase() as Hex;preparePublicKey(hexToBytes(publicKey));
  const id=keccak256(publicKey);const path=accountJobPath(id);
  if(accountJobs.has(id))return accountJobs.get(id)!;
  const job:AccountJob={id,publicKey,status:'provisioning',stage:'Waiting for the account deployment service',ownerPid:process.pid,updatedAt:Date.now()};
  accountJobs.set(id,job);await mkdir(root,{recursive:true,mode:0o700});await save(path,job);
  const update=async(stage:string)=>{job.stage=stage;job.updatedAt=Date.now();await save(path,job);};
  accountQueue=accountQueue.catch(()=>{}).then(async()=>{
    try{
      for(let attempt=0;;attempt++){
        try{job.account=await provisionPqAccount(publicKey,update);break;}
        catch(error){
          const message=error instanceof Error?error.message:'';
          if(attempt>=2||!/timeout|timed out|fetch|HTTP request failed|network|socket|ECONN/i.test(message))throw error;
          await update('Retrying the same saved deployment after a network interruption');
          await new Promise<void>(resolve=>setTimeout(resolve,1500));
        }
      }
      job.status='ready';await update('Smart account deployed; checking ownership');
    }catch(error){job.status='failed';job.error=error instanceof Error?error.message.split('\n')[0]:'Account deployment stopped. Retry the same wallet setup.';await update('Account setup stopped');}
    finally{accountJobs.delete(id);}
  });
  void accountQueue.catch(()=>{});
  return job;
}
export async function cachePqAuthorization(publicKey:Hex,raw:Hex,signature:Hex,addressHint?:Hex):Promise<{hash:Hex}> {
  const tx=decodeFrameTransaction(raw);
  assertSponsoredPqTransaction(tx);
  if(addressHint&&addressHint.toLowerCase()!==tx.sender.toLowerCase())throw Error('Account hint does not match the native sender.');
  const path=join(root,`${keccak256(publicKey.toLowerCase() as Hex)}.account.json`);
  let account=await load<PublicPqAccount>(path);
  if(!account){
    const publicReader={request:async<T>(method:string,params:unknown[]=[])=>client.request({method,params} as never) as Promise<T>};
    account=await recoverProvisionedPqAccount(publicKey,tx.sender,publicReader as ChainTransport);
    await mkdir(root,{recursive:true,mode:0o700});await save(path,account);
  }
  if(tx.sender.toLowerCase()!==account.address.toLowerCase())throw Error('Unsupported PQ authorization account.');
  const execution=tx.frames[2]!;
  const sponsor=tx.frames[1]!.target!;
  const registration=PQ_POOLS.find(pool=>pool.paymaster.toLowerCase()===sponsor.toLowerCase());
  const sponsorCode=await client.getCode({address:sponsor});
  if(!registration||!sponsorCode||keccak256(sponsorCode)!==registration.paymasterRuntimeHash)throw Error('The registered pool sponsor runtime changed.');
  if(!execution.target||await client.readContract({address:sponsor,abi:parseAbi(['function allowedAction(address target,uint256 value,bytes data) view returns(bool)']),functionName:'allowedAction',args:[execution.target,execution.value,execution.data]})!==true)throw Error('The paymaster does not sponsor this action.');
  const sigHash=tx.sigHash();
  if(!verifyAuthorization(hexToBytes(account.publicKey),sigHash,signature))throw Error('ML-DSA authorization did not verify.');
  await singleWriter(()=>gasCall(`cache:${account.address}:${sigHash}`,encodeFunctionData({abi:accountAbi,functionName:'cacheAuthorization',args:[sigHash,signature]}),account.address));
  return{hash:tx.transactionHash()};
}
