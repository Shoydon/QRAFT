import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const root = new URL('../public/pq-v5/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
for (const name of ['qraft_hiding_wasm_feasibility.js', 'qraft_hiding_wasm_feasibility_bg.wasm', 'worker-v5.js']) {
  const hash = createHash('sha256').update(await readFile(new URL(name, root))).digest('hex');
  if (hash !== manifest.files[name]) throw Error(`Pinned PQ artifact mismatch: ${name}`);
}
console.log('Verified pinned V5 browser prover, bindings and worker.');
