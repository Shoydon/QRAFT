import {readFile,writeFile,mkdir,copyFile,stat,rename} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {zKey} from 'snarkjs';
import solc from 'solc';
import {poseidonContract} from 'circomlibjs';
const dir='.local/private-pool-build',out='public/private-proving';
const toolchain=JSON.parse(await readFile('packages/private-pool/toolchain.json','utf8'));
for(const [name,base] of [['circom2','.local/private-wallet-tools/'],['circomlib','.local/private-wallet-tools/'],['snarkjs',''],['solc','']])if(JSON.parse(await readFile(base+'node_modules/'+name+'/package.json','utf8')).version!==toolchain[name])throw Error('Private toolchain version mismatch: '+name);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(command,args)=>new Promise((yes,no)=>{const p=spawn(command,args,{stdio:'inherit'});p.on('error',no);p.on('close',code=>code===0?yes():no(Error(command+' failed '+code)));});
await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});await mkdir('packages/private-pool/build',{recursive:true});
const sourceHash=hash(await readFile('packages/private-pool/circuits/join-split.circom'));
await run('.local/private-wallet-tools/node_modules/.bin/circom2',['packages/private-pool/circuits/join-split.circom','--r1cs','--wasm','--sym','-l','.local/private-wallet-tools/node_modules','-o',dir]);
const r1csHash=hash(await readFile(dir+'/join-split.r1cs'));
let previous;try{previous=JSON.parse(await readFile(out+'/manifest.json','utf8'));}catch{}
if(previous&&previous.r1csHash!==r1csHash&&!process.argv.includes('--new-dev-setup'))throw Error('Circuit changed. Explicit --new-dev-setup creates a new devnet-only setup and requires redeployment.');
const snark='node_modules/snarkjs/build/cli.cjs';
if(!previous||previous.r1csHash!==r1csHash){
 // Self-generated, single-operator development ceremony. NOT production parameters.
 try{await stat(dir+'/development-final.ptau');}catch{
  await run('node',[snark,'powersoftau','new','bn128','16',dir+'/development-0.ptau']);
  await run('node',[snark,'powersoftau','contribute',dir+'/development-0.ptau',dir+'/development-1.ptau','--name=Qraft devnet only','-e='+randomBytes(64).toString('hex')]);
  await run('node',[snark,'powersoftau','prepare','phase2',dir+'/development-1.ptau',dir+'/development-final.tmp.ptau']);
  await rename(dir+'/development-final.tmp.ptau',dir+'/development-final.ptau');
 }
 await run('node',[snark,'groth16','setup',dir+'/join-split.r1cs',dir+'/development-final.ptau',dir+'/initial.zkey']);
 await zKey.contribute(dir+'/initial.zkey',out+'/join-split.zkey','Qraft circuit devnet only',randomBytes(64).toString('hex'));
}
const verificationKey=await zKey.exportVerificationKey(out+'/join-split.zkey');
await writeFile(out+'/verification_key.json',JSON.stringify(verificationKey));
const template=await readFile('node_modules/snarkjs/templates/verifier_groth16.sol.ejs','utf8');
const verifier=(await zKey.exportSolidityVerifier(out+'/join-split.zkey',{groth16:template})).replace('contract Groth16Verifier','contract JoinSplitVerifier').replaceAll('staticcall(sub(gas(), 2000), 7,','staticcall(10000, 7,').replaceAll('staticcall(sub(gas(), 2000), 6,','staticcall(1000, 6,').replaceAll('staticcall(sub(gas(), 2000), 8,','staticcall(200000, 8,');
await writeFile('packages/private-pool/contracts/JoinSplitVerifier.sol',verifier);
const sources={};for(const name of ['PrivatePool','JoinSplitVerifier'])sources[name+'.sol']={content:await readFile('packages/private-pool/contracts/'+name+'.sol','utf8')};
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
for(const error of compiled.errors??[])if(error.severity==='error')throw Error(error.formattedMessage);
for(const contracts of Object.values(compiled.contracts))for(const [name,c]of Object.entries(contracts))if(c.evm.bytecode.object)await writeFile('packages/private-pool/build/'+name+'.json',JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object}));
await writeFile('packages/private-pool/build/Poseidon.json',JSON.stringify({abi:poseidonContract.generateABI(2),bytecode:poseidonContract.createCode(2)}));
await copyFile(dir+'/join-split_js/join-split.wasm',out+'/join-split.wasm');
await copyFile('node_modules/snarkjs/build/snarkjs.min.js',out+'/snarkjs.min.js');
const files={};for(const name of ['join-split.wasm','join-split.zkey','verification_key.json','snarkjs.min.js'])files[name]=hash(await readFile(out+'/'+name));
await writeFile(out+'/manifest.json',JSON.stringify({version:1,profile:'Groth16-BN254 single-operator development setup; not for production',sourceHash,r1csHash,inputs:4,outputs:2,depth:20,files,compiler:JSON.parse(await readFile('.local/private-wallet-tools/node_modules/circom2/package.json')).version,solc:solc.version()},null,2)+'\n');
console.log('Built and pinned devnet-only private pool artifacts.');
await globalThis.curve_bn128?.terminate();
