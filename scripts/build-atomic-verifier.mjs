/** Reproducible calldata adapter of pinned ML-DSA arithmetic. No deployed helpers. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import solc from 'solc';
const base='packages/protocol/vendor/mldsa44/';
const provenance=JSON.parse(await readFile(base+'provenance.json','utf8'));
const sources={};
for(const name of ['MLDSA44Verifier.sol','IMLDSAVerifier.sol','FastKeccak170.sol','Decode.sol','Ntt.sol','InvNtt.sol']) {
 const content=await readFile(base+'src/'+name,'utf8');
 if(createHash('sha256').update(content).digest('hex')!==provenance.sha256['src/'+name])throw Error('Upstream changed: '+name);
 sources[name]={content};
}
function patch(name,from,to){if(!sources[name].content.includes(from))throw Error('Patch mismatch: '+name+' '+from);sources[name].content=sources[name].content.replace(from,to);}
for(const name of ['Ntt.sol','InvNtt.sol']) {
 const re=/^\s*mstore\((?:PR|add\(PR, 0x[0-9a-f]+\)), gas\(\)\)\s*$/gm;
 if(sources[name].content.match(re)?.length!==(name==='Ntt.sol'?13:5))throw Error('Profiling mismatch');
 sources[name].content=sources[name].content.replace(re,'').replaceAll('uint256[] memory a, uint256[] memory prof, uint256 psirev','uint256[] memory a, uint256 psirev').replaceAll('let PR := add(prof, 0x20)','');
}
const n='MLDSA44Verifier.sol';
patch(n,'contract MLDSA44Verifier is IMLDSAVerifier {','contract MLDSA44Verifier {');
let s=sources[n].content;
s=s.slice(0,s.indexOf('    /// @dev keccak256'))+'    address private constant F1600 = address(0);\n'+s.slice(s.indexOf('    function verify('));
s=s.replace('if (F1600.codehash != F1600_CODEHASH) revert BadHelper();','').replaceAll('address pkBlob','bytes calldata pkBlob').replaceAll('address pkPtr','bytes calldata pkPtr');
s=s.replace('if eq(extcodesize(pkPtr), add(PK_SIZE, 1)) { pkOk := 1 }','pkOk := eq(pkPtr.length, PK_SIZE)');
s=s.replace('extcodecopy(pkPtr, d, 1, 64)','calldatacopy(d, pkPtr.offset, 64)');
s=s.replace('extcodecopy(pkPtr, scratch, add(1, add(PK_A_OFF, shl(12, i))), 0x1000)','calldatacopy(scratch, add(pkPtr.offset, add(PK_A_OFF, shl(12, i))), 0x1000)');
s=s.replace('extcodecopy(pkPtr, add(scratch, 0x1000), add(1, add(PK_T1_OFF, shl(10, i))), 0x400)','calldatacopy(add(scratch, 0x1000), add(pkPtr.offset, add(PK_T1_OFF, shl(10, i))), 0x400)');
s=s.replace('uint256[] memory ntProf = new uint256[](10);','').replaceAll(', ntProf,',',');
sources[n].content=s;
// Compact Keccak-f[1600] round from the already-attributed MIT implementation.
const sha=await readFile('packages/pq-hiding-stark/contracts/src/FastSha3_512.sol','utf8');
const constants=sha.slice(sha.indexOf('    bytes internal constant ROUND_CONSTANTS'),sha.indexOf('\n function hash')).replace('bytes internal constant','bytes constant');
const helpers=sha.slice(sha.indexOf('            // set a state element'),sha.indexOf('   function permutation(')).replaceAll('U64_MASK','_M64_170');
let fast=sources['FastKeccak170.sol'].content;
const a=fast.indexOf('function f1600Fast170('),b=fast.indexOf('/// @dev XOR one',a);
fast=fast.slice(0,fast.lastIndexOf('/// @notice Keccak-f',a))+constants+`\n// Keccak round adapted from ethereum-optimism/lib-keccak, MIT, copyright 2023 clabby.\nfunction f1600Fast170(uint256[25] memory st, address) pure {\n bytes memory constants=ROUND_CONSTANTS;\n assembly ("memory-safe") {\n${helpers}\n for {let round := 0} lt(round,24) {round := add(round,1)} {permute(st,add(constants,32),round)}\n }\n}\n`+fast.slice(b);
const c=fast.indexOf('function shake256Batch170('),d=fast.indexOf('/// @notice Minimal SHAKE256',c);
fast=fast.slice(0,c)+`function shake256Batch170(bytes memory input,uint256 outLen,address helper) view returns(bytes memory) {return shake256Fast170(input,outLen,helper);}\n\n`+fast.slice(d);
sources['FastKeccak170.sol'].content=fast;
sources['ShakeHarness.sol']={content:'pragma solidity ^0.8.25; import {shake256Fast170} from "./FastKeccak170.sol"; contract ShakeHarness {function hash(bytes memory input,uint256 length) external view returns(bytes memory){return shake256Fast170(input,length,address(0));}}'};
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:'prague',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
for(const e of out.errors??[])if(e.severity==='error')throw Error(e.formattedMessage);
await mkdir('packages/atomic/artifacts',{recursive:true});
for(const name of ['MLDSA44Verifier','ShakeHarness']) {
 const c=out.contracts[name+'.sol'][name];
 const size=c.evm.deployedBytecode.object.length/2;
 if(size>24576)throw Error(name+' exceeds EIP170: '+size);
 await writeFile('packages/atomic/artifacts/'+name+'.json',JSON.stringify({upstream:provenance.commit,adapter:'calldata-inline-keccak-v1',compiler:solc.version(),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object},null,2)+'\n');
 console.log(name,size,'runtime bytes');
}
