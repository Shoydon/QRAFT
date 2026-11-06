import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,posix} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import solc from 'solc';
const provenance=JSON.parse(await readFile('packages/frame-account/contracts/vendor/erc8286/provenance.json','utf8'));
for(const [name,hash] of Object.entries(provenance.sha256)){if(createHash('sha256').update(await readFile('packages/frame-account/contracts/vendor/erc8286/'+name)).digest('hex')!==hash)throw Error('Reference source changed: '+name);}
const sources={};
async function add(name){if(sources[name])return;const content=await readFile(name.startsWith('@openzeppelin/contracts/')?'.local/frame-account-tools/openzeppelin/'+name.slice('@openzeppelin/contracts/'.length):name,'utf8');sources[name]={content};for(const m of content.matchAll(/import\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g))await add(m[1].startsWith('.')?posix.normalize(posix.join(posix.dirname(name),m[1])):m[1]);}
for(const name of await readdir('packages/atomic/contracts'))if(name.endsWith('.sol'))await add('packages/atomic/contracts/'+name);
await add('protocol/contracts/SpendVerifier.sol');
await add('packages/frame-account/contracts/vendor/erc8286/ERC8286AccountFactory.sol');
const deps=JSON.parse(await readFile('.local/frame-account-tools/dependencies.json','utf8'));
const compiler=resolve('.local/frame-account-tools/solc-eip8141');
if(createHash('sha256').update(await readFile(compiler)).digest('hex')!==deps.compiler.sha256)throw Error('Compiler mismatch');
const compile=async(sources,native)=>{
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:native?'osaka+eip8141':'prague',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
 const out=native?await new Promise((yes,no)=>{const p=spawn(compiler,['--standard-json']);let stdout='';p.stdout.on('data',b=>stdout+=b);p.on('error',no);p.on('close',()=>{try{yes(JSON.parse(stdout))}catch(e){no(e)}});p.stdin.end(JSON.stringify(input));}):JSON.parse(solc.compile(JSON.stringify(input)));
 for(const e of out.errors??[])if(e.severity==='error')throw Error(e.formattedMessage);
 for(const contracts of Object.values(out.contracts))for(const [name,c]of Object.entries(contracts))if(c.evm.bytecode.object){const size=c.evm.deployedBytecode.object.length/2;if(size>24576)throw Error(name+' too large: '+size);await writeFile('packages/atomic/artifacts/'+name+'.json',JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object,compiler:native?deps.compiler:solc.version()},null,2)+'\n');console.log(name,size,'bytes');}
};
const plain=Object.fromEntries(Object.entries(sources).filter(([name])=>name.endsWith('AtomicPool.sol')||name.endsWith('SpendVerifier.sol')));
await compile(plain,false);
await compile(Object.fromEntries(Object.entries(sources).filter(([name])=>!Object.hasOwn(plain,name))),true);
