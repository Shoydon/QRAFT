import {readFile,writeFile} from 'node:fs/promises';
import {posix,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const sources={};
async function add(name){if(sources[name])return;const content=await readFile(name,'utf8');sources[name]={content};for(const m of content.matchAll(/import\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g))await add(posix.normalize(posix.join(posix.dirname(name),m[1])));}
await add('packages/private-pool/contracts/PrivatePaymaster.sol');
await add('packages/private-pool/contracts/JoinSplitVerifier.sol');
await add('packages/private-pool/contracts/PrivateProofAccount.sol');
await add('packages/private-pool/contracts/PrivateWalletFactory.sol');
await add('packages/private-pool/contracts/PrivateWalletAccount.sol');
const compiler=resolve('.local/frame-account-tools/solc-eip8141'),deps=JSON.parse(await readFile('.local/frame-account-tools/dependencies.json','utf8'));
if(createHash('sha256').update(await readFile(compiler)).digest('hex')!==deps.compiler.sha256)throw Error('Native compiler integrity mismatch');
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'osaka+eip8141',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const output=await new Promise((yes,no)=>{const p=spawn(compiler,['--standard-json']);let stdout='';p.stdout.on('data',b=>stdout+=b);p.on('error',no);p.on('close',()=>{try{yes(JSON.parse(stdout));}catch(e){no(e);}});p.stdin.end(JSON.stringify(input));});
for(const e of output.errors??[])if(e.severity==='error')throw Error(e.formattedMessage);
for(const name of ['PrivatePaymaster','PrivateProofAccount','PrivatePool','PrivateWalletFactory','PrivateWalletAccount','JoinSplitVerifier']){
 const c=output.contracts['packages/private-pool/contracts/'+name+'.sol'][name];
 await writeFile('packages/private-pool/build/'+name+'.json',JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object,compiler:deps.compiler}));
}
console.log('Built native private pool, proof account and sponsor');
