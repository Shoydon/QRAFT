/** Public V5 proof encoder. No RPC, signing, private notes or witness inputs. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat, lstat, open, readdir } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PACKAGE=join(ROOT,'packages/pq-hiding-stark');
const PROFILE='qraft-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16';
const BINARIES=['export_browser_v5','export_session_inputs_v5','export_session_fri_v5'];
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function bounded(path,max){
  const metadata=await stat(path);if(!metadata.isFile()||metadata.size===0||metadata.size>max)throw Error('Public input size limit');
  const chunks=[];let total=0;
  for await(const chunk of createReadStream(path)){total+=chunk.length;if(total>max)throw Error('Public input size limit');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function hashFile(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
async function safeOutputFile(root,name){
  const parts=name.split(/[\\/]/);
  if(parts.some(part=>!part||part==='.'||part==='..'||!/^[a-zA-Z0-9_.-]+$/.test(part)))throw Error('Invalid public output manifest path');
  if((await lstat(root)).isSymbolicLink())throw Error('Unexpected public output symlink');
  let path=root;
  for(const [index,part]of parts.entries()){
    path=join(path,part);const metadata=await lstat(path);
    if(metadata.isSymbolicLink()||(index<parts.length-1?!metadata.isDirectory():!metadata.isFile()))throw Error('Unexpected public output symlink or file type');
  }
  return path;
}
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function filesUnder(path,prefix=''){
  const result=[];
  for(const entry of await readdir(path,{withFileTypes:true})){
    const relative=join(prefix,entry.name);
    if(entry.isSymbolicLink())throw Error('Unexpected public output symlink');
    if(entry.isDirectory())result.push(...await filesUnder(join(path,entry.name),relative));
    else if(entry.isFile())result.push(relative);
  }
  return result.sort();
}
async function run(command,args,{log,stdout,timeout=600000}={}){
  const out=await open(stdout??`${log}.stdout.log`,'w',0o600);
  const err=await open(`${log}.stderr.log`,'w',0o600);
  try{
    await new Promise((resolveRun,reject)=>{
      const child=spawn(command,args,{cwd:ROOT,stdio:['ignore',out.fd,err.fd],env:{...process.env,CARGO_BUILD_JOBS:process.env.CARGO_BUILD_JOBS??'2'}});
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Public proof preparation timed out; outputs preserved'));},timeout);
      child.once('error',()=>{clearTimeout(timer);reject(Error('Could not start public proof preparation tool'));});
      child.once('close',code=>{clearTimeout(timer);if(code===0)resolveRun();else reject(Error('Public proof preparation rejected; inspect its local public logs'));});
    });
    await out.sync();await err.sync();
  }finally{await out.close();await err.close();}
}

export async function buildPublicProofEncoder({logDirectory=join(ROOT,'.local/pq-public-build')}={}){
  await mkdir(logDirectory,{recursive:true,mode:0o700});
  const cargo=process.env.CARGO??join(homedir(),'.cargo/bin/cargo');
  await run(process.env.PYTHON??'python3',[join(PACKAGE,'scripts/prepare-upstream.py')],{log:join(logDirectory,'upstream')});
  await run(cargo,['build','--locked','--release','--manifest-path',join(PACKAGE,'Cargo.toml'),...BINARIES.flatMap(name=>['--example',name])],{log:join(logDirectory,'cargo-build'),timeout:1200000});
}

/** Caller supplies separately derived expected statement/context, never a witness. */
export async function preparePublicProof({envelope,statement,output,build=false,onProgress=()=>{}}){
  if(typeof envelope!=='string'||typeof statement!=='string'||typeof output!=='string')throw Error('Public envelope, separate statement and output paths are required');
  const envelopePath=resolve(ROOT,envelope),statementPath=resolve(ROOT,statement),outputPath=resolve(ROOT,output);
  if(envelopePath===statementPath||envelopePath.startsWith(outputPath+'/')||statementPath.startsWith(outputPath+'/'))throw Error('Public inputs must be separate from the output directory');
  const [encoded,expectedBytes]=await Promise.all([bounded(envelopePath,16*1024*1024),bounded(statementPath,16384)]);
  const binding={profile:PROFILE,envelopeSha256:sha(encoded),expectedStatementSha256:sha(expectedBytes)};
  const summaryPath=join(outputPath,'public-preparation-summary.json');
  if(await exists(outputPath)){
    if(!await exists(summaryPath))throw Error('Partial public preparation exists; preserve and inspect it instead of overwriting');
    const previous=await json(await safeOutputFile(outputPath,'public-preparation-summary.json'));
    if(previous.encoderSchema!==1||previous.publicEnvelope!==true||previous.nativeVerified!==true||previous.expectedStatementWasSeparate!==true||previous.contextIndependentlyDerived!==true||previous.profile!==PROFILE||previous.envelopeSha256!==binding.envelopeSha256||previous.expectedStatementSha256!==binding.expectedStatementSha256||previous.publicOnly!==true||previous.complete!==true)throw Error('Public preparation binding changed; existing output preserved');
    if(!previous.files||typeof previous.files!=='object'||Object.keys(previous.files).length<400)throw Error('Incomplete public preparation manifest');
    for(const [name,expected]of Object.entries(previous.files)){
      if(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected)||await hashFile(await safeOutputFile(outputPath,name))!==expected)throw Error('Public output integrity mismatch');
    }
    onProgress('reused-verified-public-output');
    return {...previous,reused:true};
  }
  if(build)await buildPublicProofEncoder();
  const target=process.env.CARGO_TARGET_DIR?resolve(ROOT,process.env.CARGO_TARGET_DIR):join(PACKAGE,'target');
  const binaries=Object.fromEntries(BINARIES.map(name=>[name,join(target,'release/examples',name)]));
  for(const path of Object.values(binaries))if(!await exists(path))throw Error('Build the public encoder first with --build');
  await mkdir(dirname(outputPath),{recursive:true,mode:0o700});
  const staged=join(dirname(outputPath),`.${basename(outputPath)}.public-work-${randomUUID()}`);
  await mkdir(staged,{mode:0o700});
  const logs=join(staged,'logs');await mkdir(logs,{mode:0o700});
  const proof=join(staged,'withdrawal-proof'),transcript=join(staged,'withdrawal-transcript'),codec=join(staged,'withdrawal-codec');
  // Freeze the caller's public input bytes to close the file-change race.
  const frozenEnvelope=join(staged,'source-envelope.postcard'),frozenStatement=join(staged,'expected-public.json');
  await writeFile(frozenEnvelope,encoded,{mode:0o600});await writeFile(frozenStatement,expectedBytes,{mode:0o600});
  await run(binaries.export_browser_v5,[frozenEnvelope,frozenStatement,proof],{log:join(logs,'public-export')});
  const verified=await json(join(proof,'summary.json'));
  if(verified.publicEnvelope!==true||verified.nativeVerified!==true||verified.contextIndependentlyDerived!==true||verified.privateWitnessRead!==false||verified.envelopeSha256!==binding.envelopeSha256||verified.expectedStatementSha256!==binding.expectedStatementSha256)throw Error('Complete verified public export required');
  onProgress('public-proof-verified');
  const python=process.env.PYTHON??'python3';
  await run(python,[join(PACKAGE,'contracts/testdata/strong-transcript-v5/generate.py'),'--proof-dir',proof,'--output-dir',transcript],{log:join(logs,'transcript')});
  const challenge=join(proof,'challenges.json');
  await run(python,[join(PACKAGE,'contracts/testdata/withdrawal-codec/generate.py'),'--fixture-dir',proof,'--challenges',challenge,'--output-dir',codec],{log:join(logs,'codec')});
  const codecSummary=await json(join(codec,'summary.json'));
  if(codecSummary.actualProofAirQuotientIdentity!==true||codecSummary.batches!==93||codecSummary.sourceProofSha256!==verified.proofSha256)throw Error('Public AIR identity verification failed');
  onProgress('transcript-and-air-verified');
  const inputPath=join(staged,'input-vectors.json'),friPath=join(staged,'fri-vectors.json');
  await run(binaries.export_session_inputs_v5,[proof,challenge],{log:join(logs,'input-vectors'),stdout:inputPath});
  onProgress('input-query-authentications-verified');
  await run(binaries.export_session_fri_v5,[proof,challenge],{log:join(logs,'fri-vectors'),stdout:friPath});
  onProgress('fri-authentications-verified');
  const [inputs,fri]=await Promise.all([json(inputPath),json(friPath)]);
  if(inputs.wholeNativeV5ProofVerified!==true||inputs.batches?.length!==4||inputs.batches.some(batch=>batch.all320NativeSingletonsVerified!==true)||fri.wholeNativeV5ProofVerified!==true||fri.all120SubsetsNativeVerified!==true||fri.rounds?.length!==12)throw Error('All native public authentications must verify');
  await run(python,[join(PACKAGE,'scripts/session-vectors-v5.py'),'--proof',proof,'--inputs',inputPath,'--fri',friPath,'--output',join(staged,'session-vectors')],{log:join(logs,'session-vectors')});
  const hashes={};for(const name of await filesUnder(staged))hashes[name]=await hashFile(join(staged,name));
  const summary={...binding,encoderSchema:1,publicEnvelope:true,nativeVerified:true,expectedStatementWasSeparate:true,contextIndependentlyDerived:true,originalProverLogCompared:false,publicOnly:true,privateWitnessRead:false,privateWitnessPrinted:false,complete:true,inputQueries:320,inputGroups:4,friRounds:12,friSubsets:120,airBatches:93,files:hashes};
  await writeFile(join(staged,'public-preparation-summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  // Rename only a complete, verified generation. Incomplete work remains isolated.
  if(await exists(outputPath))throw Error('Public output appeared concurrently; existing output preserved');
  await rename(staged,outputPath);
  onProgress('public-calldata-ready');
  return {...summary,reused:false};
}
function options(argv){
  const result={build:false};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];if(arg==='--build'){result.build=true;continue;}
    if(!['--envelope','--statement','--output'].includes(arg)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Usage: prepare-pq-public-proof.mjs --envelope PUBLIC_PROOF --statement EXPECTED_PUBLIC_JSON --output DIR [--build]');
    const name=arg.slice(2);if(result[name]!==undefined)throw Error('Duplicate public preparation option');result[name]=argv[++i];
  }
  return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const result=await preparePublicProof({...options(process.argv.slice(2)),onProgress:stage=>console.log(JSON.stringify({stage,publicOnly:true,privateWitnessRead:false}))});
    console.log(JSON.stringify({profile:result.profile,complete:result.complete,publicOnly:true,privateWitnessRead:false,reused:result.reused,envelopeSha256:result.envelopeSha256,inputQueries:result.inputQueries,friSubsets:result.friSubsets,airBatches:result.airBatches}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
