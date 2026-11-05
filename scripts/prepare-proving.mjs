import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const expected = JSON.parse(await readFile(new URL('../protocol/artifacts.json', import.meta.url)));
await mkdir(new URL('../public/proving/', import.meta.url), { recursive: true });
for (const [name, hash] of Object.entries(expected)) {
  const source = name === 'verification_key.json' ? `../public/proving/${name}` : `../protocol/circuits/${name}`;
  const bytes = await readFile(new URL(source, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Proving artifact mismatch: ${name}. Restore the original file; do not regenerate keys.`);
  if (name !== 'verification_key.json') await writeFile(new URL(`../public/proving/${name}`, import.meta.url), bytes);
}
await writeFile(new URL('../public/proving/snarkjs.min.js', import.meta.url), await readFile(require.resolve('snarkjs').replace(/main\.cjs$/, 'snarkjs.min.js')));
console.log('Prepared and hash-verified the existing Himitsu proving artifacts.');
