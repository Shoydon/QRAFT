import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasm = join(root, 'wasm');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed`);
}
run(process.env.PYTHON ?? 'python3', ['scripts/prepare-upstream.py']);
const cargo = process.env.CARGO ?? 'cargo';
const bindgen = process.env.WASM_BINDGEN ?? 'wasm-bindgen';
const version = spawnSync(bindgen, ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== 'wasm-bindgen 0.2.127') {
  throw new Error('wasm-bindgen 0.2.127 is required');
}
run(cargo, ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown'], wasm);
const target = process.env.CARGO_TARGET_DIR
  ? resolve(wasm, process.env.CARGO_TARGET_DIR)
  : join(wasm, 'target');
const output = join(wasm, 'pkg');
mkdirSync(output, { recursive: true });
run(bindgen, [
  join(target, 'wasm32-unknown-unknown/release/qraft_hiding_wasm_feasibility.wasm'),
  '--target', 'web', '--out-dir', output,
]);
for (const name of ['worker.js', 'worker-v3.js', 'worker-v5.js']) copyFileSync(join(wasm, 'src', name), join(output, name));
const files = [
  'qraft_hiding_wasm_feasibility.js', 'qraft_hiding_wasm_feasibility_bg.wasm', 'worker.js', 'worker-v3.js', 'worker-v5.js',
];
writeFileSync(join(output, 'manifest.json'), JSON.stringify({
  experimental: true,
  applicationEnabled: false,
  quantumSecurityEstablished: false,
  files: Object.fromEntries(files.map(name => [name, createHash('sha256').update(readFileSync(join(output, name))).digest('hex')])),
}, null, 2) + '\n');
console.log('Built membership, v3 and v5 withdrawal proof Workers; application remains disabled.');
