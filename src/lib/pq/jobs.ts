/** Public-proof preparation and permissionless computation. No custody keys/witnesses. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, open, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPublicClient, http, encodeFunctionData, decodeAbiParameters, parseEventLogs, bytesToHex, type Abi, type AbiParameter, type Hex } from 'viem';
import manifest from '../../../public/pq-deployment.json';
import abis from '../../../public/pq-v5/abis.json';
import { runPublicCall, runPublicProgram } from './service';

const root=resolve('.local/pq-service/proofs');
const client=createPublicClient({cacheTime:0,transport:http(manifest.rpcUrl,{timeout:60000,retryCount:0})});
const running=new Set<string>();
interface ExpectedStatement{profile:string;root:number[];nullifier:number[];context:number[];publicContext:{chainIdHex:string;poolHex:string;recipientHex:string;relayerHex:string;denomination:string;fee:string;deadline:string};}
export function validatePublicStatement(input:unknown):asserts input is ExpectedStatement{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Only a public proof statement is accepted.');
  const statement=input as Record<string,unknown>;
  const top=['profile','root','nullifier','context','publicContext'];
  if(Object.keys(statement).length!==top.length||Object.keys(statement).some(key=>!top.includes(key))||statement.profile!==manifest.profile||
    !['root','nullifier','context'].every(key=>Array.isArray(statement[key])&&(statement[key] as unknown[]).length===64&&(statement[key] as unknown[]).every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=255)))throw Error('Only a complete public proof statement is accepted.');
  const context=statement.publicContext;
  if(!context||typeof context!=='object'||Array.isArray(context))throw Error('Invalid public withdrawal context.');
  const fields=context as Record<string,unknown>;const names=['chainIdHex','poolHex','recipientHex','relayerHex','denomination','fee','deadline'];
  if(Object.keys(fields).length!==names.length||Object.keys(fields).some(key=>!names.includes(key)))throw Error('Only the fixed public withdrawal context fields are accepted.');
  for(const key of ['chainIdHex','poolHex','recipientHex','relayerHex'])if(typeof fields[key]!=='string'||!new RegExp(`^(?:0x)?[0-9a-fA-F]{${key==='chainIdHex'?64:40}}$`).test(fields[key] as string))throw Error('Invalid public context field width.');
  for(const key of ['denomination','fee','deadline'])if(typeof fields[key]!=='string'||!/^(0|[1-9][0-9]*)$/.test(fields[key] as string))throw Error('Invalid public context integer.');
  const hex=(key:string)=>String(fields[key]).toLowerCase().replace(/^0x/,'');
  if(BigInt('0x'+hex('chainIdHex'))!==8141n||hex('poolHex')!==manifest.pool.toLowerCase().slice(2)||fields.denomination!==manifest.denominationWei||fields.fee!=='0'||BigInt(fields.deadline as string)>=(1n<<64n)||BigInt('0x'+hex('recipientHex'))===0n||hex('recipientHex')===hex('poolHex')||BigInt('0x'+hex('relayerHex'))!==0n)throw Error('Public context does not describe this native ETH PQ deployment.');
}
export interface PqProofJob{id:string;phase:'encoding'|'ready'|'uploading'|'uploaded'|'verifying'|'verified'|'failed';stage:string;statement:ExpectedStatement;claimsBlob?:string;windowBlob?:string;sessionId?:Hex;done?:number;total?:number;error?:string;ownerPid?:number;encoderPid?:number;updatedAt?:number;}
function directory(id:string){if(!/^[0-9a-f]{64}$/.test(id))throw Error('Invalid public proof ID.');return join(root,id);}
async function save(job:PqProofJob){job.updatedAt=Date.now();const path=join(directory(job.id),'job.json');const file=await open(path+'.tmp','w',0o600);try{await file.writeFile(JSON.stringify(job));await file.sync();}finally{await file.close();}await rename(path+'.tmp',path);}
function alive(pid:number|undefined){if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}}
export async function proofJob(id:string):Promise<PqProofJob>{
 const job=JSON.parse(await readFile(join(directory(id),'job.json'),'utf8')) as PqProofJob;
 if(job.phase==='encoding'&&!alive(job.encoderPid)&&Date.now()-(job.updatedAt??0)>5000){
  try{const summary=JSON.parse(await readFile(join(directory(id),'encoded/public-preparation-summary.json'),'utf8')) as Record<string,unknown>;
   if(summary.complete!==true||summary.nativeVerified!==true||summary.publicOnly!==true||summary.contextIndependentlyDerived!==true)throw Error('Incomplete generation');
   job.phase='ready';job.stage='Public proof encoding recovered';await save(job);
  }catch{job.phase='failed';job.error='Public proof encoding was interrupted. Resubmit the same public proof to resume safely.';await save(job);}
 }else if(['uploading','verifying'].includes(job.phase)&&!alive(job.ownerPid)){
  job.phase='failed';job.error='The local verifier process stopped. Preserve its signed journal and reconcile the carrier lock before resuming.';await save(job);
 }
 return job;
}
async function fail(job:PqProofJob,error:unknown){job.phase='failed';job.error=error instanceof Error?error.message.split('\n')[0]:'Public proof computation failed.';await save(job);}
export async function acceptPublicProof(bytes:Uint8Array,statementText:string):Promise<PqProofJob>{
  if(!manifest.applicationEnabled)throw Error('The QRAFT protocol requires a fresh deployment. Public proof submission is disabled.');
  if(bytes.length<72||bytes.length>16*1024*1024||statementText.length>16384)throw Error('Public proof size limit.');
  const statement:unknown=JSON.parse(statementText);validatePublicStatement(statement);
  const id=createHash('sha256').update(bytes).update(statementText).digest('hex');
  await mkdir(directory(id),{recursive:true,mode:0o700});
  try{const prior=await proofJob(id);if(prior.phase!=='failed'||prior.claimsBlob||alive(prior.encoderPid))return prior;}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ENOENT')throw error;}
  const job:PqProofJob={id,phase:'encoding',stage:'Checking the public proof',statement,ownerPid:process.pid};
  await writeFile(join(directory(id),'envelope.postcard'),bytes,{mode:0o600});
  await writeFile(join(directory(id),'expected.json'),statementText,{mode:0o600});await save(job);
  const out=await open(join(directory(id),'encoder.log'),'w',0o600);
  const child=spawn(process.execPath,['scripts/prepare-pq-public-proof.mjs','--envelope',join(directory(id),'envelope.postcard'),'--statement',join(directory(id),'expected.json'),'--output',join(directory(id),'encoded')],{cwd:process.cwd(),stdio:['ignore',out.fd,out.fd]});
  job.encoderPid=child.pid;await save(job);
  await out.close();
  const timeout=setTimeout(()=>child.kill('SIGKILL'),20*60*1000);
  let settled=false;
  child.once('error',error=>{clearTimeout(timeout);if(settled)return;settled=true;void fail(job,error);});
  child.once('close',code=>{clearTimeout(timeout);if(settled)return;settled=true;void(async()=>{const latest=JSON.parse(await readFile(join(directory(id),'job.json'),'utf8')) as PqProofJob;if(latest.phase!=='encoding')return;if(code!==0){await fail(latest,Error('Public proof encoding failed; keep the proof and inspect its local log.'));return;}latest.phase='ready';latest.stage='Public proof and all authentications verified';await save(latest);})();});
  return job;
}
const abiFor=(name:'blobs'|'session')=>abis[name] as Abi;
const call=(name:'blobs'|'session',functionName:string,args:readonly unknown[])=>({to:manifest.contracts[name].address as Hex,data:encodeFunctionData({abi:abiFor(name),functionName,args})});
async function uploadBlob(job:PqProofJob,label:string,bytes:Uint8Array):Promise<string>{
  const begin=call('blobs','begin',[BigInt(bytes.length)]);
  const hash=await runPublicCall(`${job.id}:blob:${label}:begin`,begin.to,begin.data);
  const receipt=await client.getTransactionReceipt({hash});
  const events=parseEventLogs({abi:abiFor('blobs'),logs:receipt.logs,eventName:'Begun',strict:true});
  if(events.length!==1)throw Error('Missing public blob creation event.');
  const id=BigInt((events[0]!.args as {blobId:bigint}).blobId);
  const calls=[];
  for(let at=0;at<bytes.length;at+=8192)calls.push(call('blobs','append',[id,bytesToHex(bytes.subarray(at,Math.min(bytes.length,at+8192)))]));
  calls.push(call('blobs','seal',[id]));
  await runPublicProgram(`${job.id}:blob:${label}:data`,calls,async n=>{job.stage=`Publishing public ${label} data ${n}/${calls.length}`;await save(job);});
  const isSealed=await client.readContract({address:manifest.contracts.blobs.address as Hex,abi:abiFor('blobs'),functionName:'isSealed',args:[id]});
  if(isSealed!==true)throw Error('Public proof data is not sealed.');
  const read=await client.readContract({address:manifest.contracts.blobs.address as Hex,abi:abiFor('blobs'),functionName:'read',args:[id]}) as Hex;
  if(read.toLowerCase()!==bytesToHex(bytes).toLowerCase())throw Error('Sealed public data differs from the verified proof.');
  return String(id);
}
export async function uploadPublicData(id:string):Promise<PqProofJob>{
  const job=await proofJob(id);if(job.phase==='uploaded'||job.phase==='verified'||job.phase==='verifying'||running.has(id)||(job.phase==='uploading'&&alive(job.ownerPid)))return job;
  if(job.phase!=='ready'&&job.phase!=='failed')throw Error('The public proof is not ready.');
  running.add(id);job.phase='uploading';job.error=undefined;job.ownerPid=process.pid;await save(job);
  void(async()=>{try{
    const summary=JSON.parse(await readFile(join(directory(id),'encoded/public-preparation-summary.json'),'utf8')) as Record<string,unknown>;
    if(summary.encoderSchema!==1||summary.publicEnvelope!==true||summary.nativeVerified!==true||summary.expectedStatementWasSeparate!==true||summary.contextIndependentlyDerived!==true||summary.originalProverLogCompared!==false||summary.publicOnly!==true||summary.privateWitnessRead!==false||summary.complete!==true)throw Error('A complete independently verified public export is required.');
    job.claimsBlob=await uploadBlob(job,'claims',await readFile(join(directory(id),'encoded/withdrawal-codec/claims.abi')));
    job.windowBlob=await uploadBlob(job,'window',await readFile(join(directory(id),'encoded/withdrawal-codec/air-window.bin')));
    job.phase='uploaded';job.stage='Public data sealed';await save(job);
  }catch(error){await fail(job,error);}finally{running.delete(id);}})();return job;
}
export async function proofMaterial(id:string):Promise<Hex>{return bytesToHex(await readFile(join(directory(id),'encoded/session-vectors/material.abi')));}
const DIGEST:AbiParameter={type:'tuple',components:[{name:'a',type:'bytes32'},{name:'b',type:'bytes32'}]};
const OPENING:AbiParameter={type:'tuple',components:[{name:'rows',type:'bytes[][]'},{name:'salts',type:'bytes[][]'},{name:'siblings',type:'tuple[]',components:'components'in DIGEST?DIGEST.components:[]}]};
export async function verifyPublicSession(id:string,sessionId:Hex):Promise<PqProofJob>{
  const job=await proofJob(id);if(running.has(id)||(job.phase==='verifying'&&alive(job.ownerPid))||job.phase==='verified')return job;if(job.sessionId&&job.sessionId!==sessionId)throw Error('The frozen proof belongs to another session.');
  if(!job.claimsBlob||!job.windowBlob||!/^0x[0-9a-fA-F]{64}$/.test(sessionId))throw Error('Public data/session is not ready.');
  running.add(id);job.phase='verifying';job.error=undefined;job.ownerPid=process.pid;job.sessionId=sessionId;job.done=0;job.total=663;await save(job);
  void(async()=>{try{
    const path=join(directory(id),'encoded');const calls:{to:Hex;data:Hex}[]=[];
    const transcript=JSON.parse(await readFile(join(path,'withdrawal-proof/transcript-hashes.json'),'utf8')) as {consumedBytes:number}[];
    if(transcript.length!==16)throw Error('Exactly sixteen transcript moves are required.');
    for(const move of transcript.keys()){
      calls.push(call('session','beginTranscriptMove',[sessionId]),call('session','deriveTranscriptKey',[sessionId]));
      const blocks=Math.ceil(transcript[move]!.consumedBytes/64);
      if(blocks<1||blocks>40)throw Error('Unexpected public transcript block count.');
      for(let i=0;i<blocks;i++)calls.push(call('session','transcriptBlock',[sessionId]));
    }
    calls.push(call('session','prepareAir',[sessionId,BigInt(job.windowBlob!)]));
    for(let i=0;i<93;i++)calls.push(call('session','foldAirBatch',[sessionId,(await readFile(`packages/pq-hiding-stark/contracts/testdata/air-program/batch-${String(i).padStart(3,'0')}.hex`,'utf8')).trim() as Hex]));
    calls.push(call('session','checkQuotient',[sessionId]));
    for(let i=0;i<41;i++)calls.push(call('session','projectClaim',[sessionId]));
    for(let i=0;i<320;i++){
      const [openings]=decodeAbiParameters([{type:'tuple[4]',components:'components'in OPENING?OPENING.components:[]}],bytesToHex(await readFile(join(path,`session-vectors/input-${String(i).padStart(3,'0')}.abi`))));
      calls.push(call('session','verifyInputQuery',[sessionId,openings]));
    }
    for(let round=0;round<12;round++)for(let start=0;start<320;start+=32){
      const args=decodeAbiParameters([{type:'uint256[5][]'},{type:'bytes[][]'},{type:'tuple[]',components:'components'in DIGEST?DIGEST.components:[]}],bytesToHex(await readFile(join(path,`session-vectors/fri-${String(round).padStart(2,'0')}-${String(start).padStart(3,'0')}.abi`))));
      calls.push(call('session','foldFri',[sessionId,...args]));
    }
    if(calls.length!==663)throw Error('The complete public verifier program is required.');
    await runPublicProgram(`${id}:session:${sessionId}`,calls,async done=>{job.done=done;job.stage=`Verifying the complete proof ${done}/663`;await save(job);});
    const progress=await client.readContract({address:manifest.contracts.session.address as Hex,abi:abiFor('session'),functionName:'progress',args:[sessionId]}) as readonly bigint[];
    if(progress.map(String).join(',')!=='9,16,93,21,320,6080,12,0')throw Error('The verifier did not establish every required proof gate.');
    job.phase='verified';job.stage='Full onchain proof verified';await save(job);
  }catch(error){await fail(job,error);}finally{running.delete(id);}})();return job;
}
