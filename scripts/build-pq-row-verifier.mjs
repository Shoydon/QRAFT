/** Build the descriptor/row storage adapter without modifying pinned upstream cryptography. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import solc from 'solc';
const base='packages/protocol/vendor/mldsa44/src/';
const sources={};
for(const name of ['MLDSA44Verifier.sol','IMLDSAVerifier.sol','FastKeccak170.sol','Decode.sol','Ntt.sol','InvNtt.sol']) sources[name]={content:await readFile(base+name,'utf8')};
let source=sources['MLDSA44Verifier.sol'].content;
const replace=(old,next)=>{if(!source.includes(old))throw Error('Upstream row adapter patch does not match');source=source.replace(old,next);};
replace('if eq(extcodesize(pkPtr), add(PK_SIZE, 1)) { pkOk := 1 }', `if eq(extcodesize(pkPtr), 273) {
                pkOk := 1
                let p := mload(0x40)
                for { let i := 0 } lt(i, 4) { i := add(i, 1) } {
                    extcodecopy(pkPtr, p, add(65, mul(i, 52)), 52)
                    let row := shr(96, mload(p))
                    if iszero(and(eq(extcodesize(row), 5121), eq(extcodehash(row), mload(add(p, 20))))) { pkOk := 0 }
                }
            }`);
replace(`extcodecopy(pkPtr, scratch, add(1, add(PK_A_OFF, shl(12, i))), 0x1000)
                extcodecopy(pkPtr, add(scratch, 0x1000), add(1, add(PK_T1_OFF, shl(10, i))), 0x400)`,
`extcodecopy(pkPtr, scratch, add(65, mul(i, 52)), 20)
                let row := shr(96, mload(scratch))
                extcodecopy(row, scratch, 1, 0x1400)`);
sources['MLDSA44Verifier.sol'].content=source;
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'prague',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}}})));
for(const e of out.errors??[])if(e.severity==='error')throw Error(e.formattedMessage);
const c=out.contracts['MLDSA44Verifier.sol'].MLDSA44Verifier;
await mkdir('packages/frame-account/artifacts',{recursive:true});
await writeFile('packages/frame-account/artifacts/MLDSA44RowsVerifier.json',JSON.stringify({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtime:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences},null,2));
console.log('Built row verifier:',c.evm.deployedBytecode.object.length/2,'bytes');
