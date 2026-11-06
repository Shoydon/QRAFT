/** Local CLI proof worker. Private witness enters over stdin, never command arguments. */
import {readFile} from 'node:fs/promises';
import {groth16} from 'snarkjs';
let text='';for await(const chunk of process.stdin)text+=chunk;
try{
 const {proof,publicSignals}=await groth16.fullProve(JSON.parse(text),'protocol/circuits/spend.wasm','protocol/circuits/spend.zkey',undefined,undefined,{singleThread:true});
 const vk=JSON.parse(await readFile('public/proving/verification_key.json','utf8'));
 if(!await groth16.verify(vk,publicSignals,proof))throw Error('Local proof rejected');
 const words=(await groth16.exportSolidityCallData(proof,publicSignals)).match(/0x[0-9a-fA-F]+/g).slice(0,8);
 process.stdout.write(JSON.stringify({words,publicSignals}));
}finally{await globalThis.curve_bn128?.terminate();}
