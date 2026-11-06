import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile('public/private-proving/manifest.json','utf8'));
if(hash(await readFile('packages/private-pool/circuits/join-split.circom'))!==manifest.sourceHash)throw Error('Private circuit changed: rebuild and redeploy its development verifier');
for(const [name,expected] of Object.entries(manifest.files))if(hash(await readFile('public/private-proving/'+name))!==expected)throw Error('Private proving artifact mismatch: '+name);
console.log('Verified private-wallet circuit and proving artifacts.');
