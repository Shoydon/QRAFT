import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=['scripts/build-atomic-verifier.mjs','scripts/build-atomic.mjs','scripts/generate-atomic-pool.mjs',
 ...['AtomicAccount','AtomicFactory','AtomicPool','AtomicPaymaster'].map(n=>`packages/atomic/contracts/${n}.sol`),
 ...['AtomicAccount','AtomicFactory','AtomicPool','AtomicPaymaster','MLDSA44Verifier','SpendVerifierStock'].map(n=>`packages/atomic/artifacts/${n}.json`),
 'protocol/contracts/SpendVerifier.sol','packages/frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol','packages/pq-hiding-stark/contracts/src/FastSha3_512.sol'];
const hashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const path='packages/atomic/integrity.json';
if(process.argv.includes('--write'))await writeFile(path,JSON.stringify(hashes,null,2)+'\n');
else{const expected=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(hashes)!==JSON.stringify(expected))throw Error('Atomic sources/artifacts changed: rebuild, test and explicitly refresh integrity.json');console.log('Verified atomic sources and deployment artifacts.');}
