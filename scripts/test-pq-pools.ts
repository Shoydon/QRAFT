/** Disposable devnet integration; direct RPC diagnostics, not an anonymous-connectivity claim. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http, type Hex } from 'viem';
import manifest from '../public/pq-deployment.json';
import { PQ_POOLS, parseRegisteredPqNote } from '../src/lib/pq/registry';
import { PqAccountClient, type PublicJournalStorage } from '../src/lib/pq/account';
import { PqPoolClient } from '../src/lib/pq/pool';
import { createPqNote, serializePqNote } from '../src/lib/pq/note';
import { withCarrierLock } from '../src/lib/pq/carrier-lock';
import { gasCall } from '../src/lib/pq/service';
import type { ChainTransport } from '../src/lib/transport/types';

const backupPath = process.env.QRAFT_TEST_WALLET;
if (!backupPath) throw Error('Set QRAFT_TEST_WALLET to a protected disposable wallet backup.');
const root = resolve('.local/fixed-pools-live'); await mkdir(root, { recursive: true, mode: 0o700 });
const origin = process.env.QRAFT_BROWSER_URL ?? 'http://127.0.0.1:3007';
const rpc = createPublicClient({ cacheTime: 0, transport: http(manifest.rpcUrl, { timeout: 60000, retryCount: 0 }) });
const load = async <T>(name: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(`${root}/${name}`, 'utf8')); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return fallback; throw error; }
};
const save = async (name: string, value: unknown) => {
  await writeFile(`${root}/${name}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(`${root}/${name}.tmp`, `${root}/${name}`);
};
const journal = await load<Record<string, string>>('journal.json', {});
const storage: PublicJournalStorage = {
  getItem: key => journal[key] ?? null,
  setItem: (key, value) => { journal[key] = value; writeFileSync(`${root}/journal.json`, JSON.stringify(journal), { mode: 0o600 }); },
  removeItem: key => { delete journal[key]; writeFileSync(`${root}/journal.json`, JSON.stringify(journal), { mode: 0o600 }); },
};
const transport: ChainTransport = {
  start() {}, stop() {}, subscribe: () => () => {},
  getStatus: () => ({ phase: 'ready', network: 'Explicit direct integration test', code: null, detail: null, lastLatencyMs: null, requestCount: 0 }),
  async request<T>(method: string, params: unknown[] = []): Promise<T> { return await rpc.request({ method, params } as never) as T; },
};
const backup = await readFile(backupPath, 'utf8');
const wallet = await PqAccountClient.restore(backup, transport, {
  journalStorage: storage,
  withLock: (_name, operation) => withCarrierLock(`${root}/account`, operation),
  fetch: (input, init) => fetch(new URL(String(input), origin), { ...init, headers: { 'content-type': 'application/json', origin } }),
});
await writeFile(`${root}/wallet.json`, backup, { mode: 0o600 });
const report = await load<{ account: string; deposits: { pool: string; amountWei: string; hash: Hex; payer: string; frames: number }[] }>('evidence.json', { account: wallet.address, deposits: [] });
assert.equal(report.account, wallet.address);
assert.deepEqual(PQ_POOLS.map(p => p.denominationWei), ['100000000000000','1000000000000000','10000000000000000','100000000000000000']);
await withCarrierLock(resolve('.local/pq-service'), () => gasCall(`fixed-pools-integration:${wallet.address}:principal`, '0x', wallet.address, 111100000000000000n));
for (const registration of PQ_POOLS) {
  if (report.deposits.some(entry => entry.pool === registration.pool)) continue;
  const pool = new PqPoolClient(transport, registration);
  const name = `note-${registration.denominationWei}.txt`;
  let text: string;
  try { text = await readFile(`${root}/${name}`, 'utf8'); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; text = serializePqNote(createPqNote(registration)); await writeFile(`${root}/${name}`, text, { mode: 0o600 }); }
  const { note, pool: recovered } = parseRegisteredPqNote(text);
  assert.equal(recovered.pool, registration.pool);
  const before = await wallet.balance();
  const result = wallet.pending
    ? await pool.reconcileDeposit(wallet, note, wallet.pending.hash, console.log)
    : await pool.deposit(wallet, note, console.log);
  assert.equal(result.kind, 'confirmed', 'Keep the saved account journal and note on failure.');
  if (result.kind !== 'confirmed') throw Error('Deposit unresolved.');
  assert.equal(result.receipt.payer?.toLowerCase(), registration.paymaster.toLowerCase());
  assert.equal(result.receipt.frameReceipts?.length, 3);
  const after = await wallet.balance(); assert.equal(before - after, BigInt(registration.denominationWei));
  const status = await pool.noteStatus(note); assert.ok(status.leaf); assert.equal(status.spent, false);
  report.deposits.push({ pool: registration.pool, amountWei: registration.denominationWei, hash: result.hash, payer: result.receipt.payer!, frames: 3 });
  await save('evidence.json', report);
  console.log(JSON.stringify(report.deposits.at(-1)));
}
wallet.lock(); console.log('PASS four sponsored native ETH deposits, exact principal debits, registered note recovery and authenticated deposit histories.');
