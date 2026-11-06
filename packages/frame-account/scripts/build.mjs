import {readFile, writeFile, readdir, mkdir} from 'node:fs/promises';
import {resolve, dirname, join, posix} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const root=resolve('packages/frame-account/contracts');
const upstream=join(root,'vendor/erc8286');
const provenance=JSON.parse(await readFile(join(upstream,'provenance.json'),'utf8'));
for(const [name,hash] of Object.entries(provenance.sha256)) {
  const actual=createHash('sha256').update(await readFile(join(upstream,name))).digest('hex');
  if(actual!==hash)throw Error('Changed reference source: '+name);
}
const solc=resolve(process.env.FRAME_SOLC??'.local/frame-account-tools/solc-eip8141');
const deps=JSON.parse(await readFile('.local/frame-account-tools/dependencies.json','utf8'));
if(createHash('sha256').update(await readFile(solc)).digest('hex')!==deps.compiler.sha256)throw Error('Compiler hash mismatch');
const sources={};
async function add(name){
  if(sources[name])return;
  const path=name.startsWith('@openzeppelin/contracts/')
    ?join('.local/frame-account-tools/openzeppelin',name.slice('@openzeppelin/contracts/'.length))
    :join(root,name);
  const content=await readFile(path,'utf8');sources[name]={content};
  for(const m of content.matchAll(/import\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g))
    await add(m[1].startsWith('.')?posix.normalize(posix.join(posix.dirname(name),m[1])):m[1]);
}
for(const name of await readdir(join(root,'src')))if(name.endsWith('.sol'))await add('src/'+name);
await add('vendor/erc8286/ERC8286AccountFactory.sol');
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'osaka+eip8141',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}};
const output=await new Promise((yes,no)=>{
  const p=spawn(solc,['--standard-json']);let stdout='',stderr='';
  p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',no);
  p.on('close',code=>{if(code!==0)return no(Error('Compiler exited: '+stderr));try{yes(JSON.parse(stdout));}catch(e){no(e);}});
  p.stdin.end(JSON.stringify(input));
});
const errors=(output.errors??[]).filter(e=>e.severity==='error');
if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
const out=resolve('packages/frame-account/artifacts');await mkdir(out,{recursive:true});
for(const [source,contracts] of Object.entries(output.contracts))for(const [name,c] of Object.entries(contracts)){
  if(!source.startsWith('src/')&&name!=='ERC8286AccountFactory')continue;
  if(!c.evm.bytecode.object)continue;
  if(c.evm.deployedBytecode.object.length/2>24576)throw Error('Code too large: '+name);
  await writeFile(join(out,name+'.json'),JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences,compiler:deps.compiler,evmVersion:input.settings.evmVersion,upstream:provenance.commit},null,2)+'\n');
  console.log(name+': '+c.evm.deployedBytecode.object.length/2+' runtime bytes');
}
await writeFile(join(out,'source-pins.json'),JSON.stringify(Object.fromEntries(Object.entries(sources).map(([p,v])=>[p,createHash('sha256').update(v.content).digest('hex')])),null,2)+'\n');
