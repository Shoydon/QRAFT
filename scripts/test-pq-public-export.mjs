/** Mutation checks for the public-only encoder. Pass an existing PUBLIC envelope. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, access, rename, symlink, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePublicProof } from './prepare-pq-public-proof.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length!==2 && !(args.length===4 && args[2]==='--prepared'))throw Error('Usage: node test-pq-public-export.mjs PUBLIC_ENVELOPE EXPECTED_PUBLIC_JSON [--prepared VERIFIED_OUTPUT_DIR]');
const envelope=await readFile(resolve(args[0])),statement=JSON.parse(await readFile(resolve(args[1])));
await mkdir(join(root,'.local'),{recursive:true});
const temp=await mkdtemp(join(root,'.local/pq-public-export-mutations-'));
const binary=join(root,'packages/pq-hiding-stark/target/release/examples/export_browser_v5');
async function check(name,proof,expected,valid=false){
  const e=join(temp,`${name}.postcard`),s=join(temp,`${name}.json`),out=join(temp,`${name}-output`);
  await writeFile(e,proof);await writeFile(s,JSON.stringify(expected));
  const result=spawnSync(binary,[e,s,out],{encoding:'utf8',maxBuffer:1024*1024,timeout:120000});
  if(result.error)throw result.error;
  if(valid){assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(await readFile(join(out,'summary.json'))).nativeVerified,true);}
  else{assert.notEqual(result.status,0);await assert.rejects(access(out));}
  console.log(`PASS public encoder ${name}`);
}
await check('valid-independent-statement',envelope,statement,true);
const wrongProfile=structuredClone(statement);wrongProfile.profile='legacy-or-unknown-profile';
await check('wrong-profile',envelope,wrongProfile);
const changedRoot=structuredClone(statement);changedRoot.root[0]^=1;
await check('changed-root',envelope,changedRoot);
const changedNullifier=structuredClone(statement);changedNullifier.nullifier[0]^=1;
await check('changed-nullifier',envelope,changedNullifier);
const changedContext=structuredClone(statement);changedContext.publicContext.recipientHex='33'.repeat(20);
await check('changed-recipient-context',envelope,changedContext);
const withWitness=structuredClone(statement);withWitness.witness={secret:'refused'};
await check('witness-field',envelope,withWitness);
const withSecret=structuredClone(statement);withSecret.publicContext.secret='refused';
await check('nested-secret-field',envelope,withSecret);
await check('trailing-proof-bytes',Buffer.concat([envelope,Buffer.from([0])]),statement);
const corrupted=Buffer.from(envelope);corrupted[0]^=1;
await check('corrupted-envelope',corrupted,statement);
await check('truncated-envelope',envelope.subarray(0,72),statement);

if(args[2]==='--prepared'){
  const options={envelope:resolve(args[0]),statement:resolve(args[1]),output:resolve(args[3])};
  const reused=await preparePublicProof(options);assert.equal(reused.reused,true);
  console.log('PASS public preparation same-input reuse with all output hashes checked');
  const changedPath=join(temp,'changed-binding.json');
  await writeFile(changedPath,JSON.stringify(changedContext));
  await assert.rejects(preparePublicProof({...options,statement:changedPath}),/binding changed/);
  console.log('PASS public preparation changed input preserves existing generation');
  const material=join(options.output,'session-vectors/material.abi');
  const original=await readFile(material);const changed=Buffer.from(original);changed[0]^=1;
  try{
    await writeFile(material,changed);
    await assert.rejects(preparePublicProof(options),/integrity mismatch/);
    console.log('PASS public preparation output tampering refuses reuse');
  }finally{await writeFile(material,original);}
  const backedUp=material+'.original';await rename(material,backedUp);
  try{
    await symlink(backedUp,material);
    await assert.rejects(preparePublicProof(options),/symlink/);
    console.log('PASS public preparation refuses output file symlinks');
  }finally{await unlink(material);await rename(backedUp,material);}
  const alias=join(temp,'output-alias');await symlink(options.output,alias);
  await assert.rejects(preparePublicProof({...options,output:alias}),/symlink/);
  console.log('PASS public preparation refuses output root symlinks');
}
