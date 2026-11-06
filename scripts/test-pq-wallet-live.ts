/** Explicit DIRECT-RPC devnet test. This does not claim anonymous browser connectivity. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { createPublicClient, http, bytesToHex, hexToBytes, parseAbi, type Hex } from 'viem';
import manifest from '../public/pq-deployment.json';
import { PqAccountClient, type PqFetch, type PublicJournalStorage } from '../src/lib/pq/account';
import { decodeFrameTransaction, Frame, FrameTx, assertSuccessfulSimulation, type FrameSimulation } from '../packages/frame-account/src/frametx';
import type { ChainTransport } from '../src/lib/transport/types';

const directory = '.local/qraft-wallet-live';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const origin = process.env.QRAFT_BROWSER_URL ?? 'http://127.0.0.1:3006';
const rpc = createPublicClient({ cacheTime: 0, transport: http(manifest.rpcUrl, { retryCount: 0, timeout: 60000 }) });
const sponsor = manifest.contracts.paymaster.address as Hex;
const owner = await rpc.readContract({ address: sponsor, abi: parseAbi(['function owner() view returns(address)']), functionName: 'owner' });
let cacheBody: Record<string, string> | null = null;
let sentRaw: Hex | null = null;
const fetcher: PqFetch = async (input, init) => {
  if (String(input) === '/api/pq/cache') cacheBody = JSON.parse(String(init?.body)) as Record<string, string>;
  return fetch(new URL(String(input), origin), { ...init, headers: { 'content-type': 'application/json', origin } });
};
const transport: ChainTransport = {
  getStatus: () => ({ phase: 'ready', network: 'Explicit direct devnet test', detail: null, code: null, lastLatencyMs: 0, requestCount: 0 }),
  start() {}, stop() {}, subscribe: () => () => {},
  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    if (method === 'eth_sendRawTransaction') sentRaw = params[0] as Hex;
    return await rpc.request({ method, params } as never) as T;
  },
};
const path = (name: string) => `${directory}/${name}`;
const save = (name: string, value: unknown) => {
  writeFileSync(path(name) + '.tmp', JSON.stringify(value), { mode: 0o600 });
  renameSync(path(name) + '.tmp', path(name));
};
if (!existsSync(path('seed.json'))) save('seed.json', { chainId: manifest.chainId, genesisHash: manifest.genesisHash, seed: bytesToHex(randomBytes(32)) });
if (statSync(path('seed.json')).mode & 0o077) throw Error('Test seed permissions must be 0600.');
const seed = JSON.parse(readFileSync(path('seed.json'), 'utf8')) as { chainId: number; genesisHash: string; seed: Hex };
assert.equal(seed.chainId, manifest.chainId); assert.equal(seed.genesisHash, manifest.genesisHash);
const journal = existsSync(path('journal.json')) ? JSON.parse(readFileSync(path('journal.json'), 'utf8')) as Record<string, string> : {};
const storage: PublicJournalStorage = { getItem: key => journal[key] ?? null, setItem: (key, value) => { journal[key] = value; save('journal.json', journal); }, removeItem: key => { delete journal[key]; save('journal.json', journal); } };
const options = { onProgress: (label: string) => console.log(label), fetch: fetcher, journalStorage: storage, withLock: async <T>(_name: string, operation: () => Promise<T>) => operation() };
const wallet = await PqAccountClient.create(transport, { ...options, seed: hexToBytes(seed.seed) });
save('backup.json', JSON.parse(wallet.backup())); wallet.markBackedUp();
console.log(JSON.stringify({ phase: 'deployed', account: wallet.address, runtimeBytes: ((await rpc.getCode({ address: wallet.address }))!.length - 2) / 2, paymaster: sponsor }));
if (wallet.pending) { const result = await wallet.reconcile({ timeoutMs: 180000 }); assert.equal(result.kind, 'confirmed'); }
const accountBefore = await wallet.balance(), sponsorBefore = await rpc.getBalance({ address: sponsor });
const result = await wallet.send({ to: owner, data: '0x', timeoutMs: 180000, onProgress: label => console.log(label) });
assert.equal(result.kind, 'confirmed', 'Sponsored wallet transaction must confirm; preserve its journal on failure.');
if (result.kind !== 'confirmed' || !sentRaw || !cacheBody) throw Error('Missing exact public transaction evidence.');
assert.equal(result.receipt.payer?.toLowerCase(), sponsor.toLowerCase());
assert(result.receipt.frameReceipts); assert.equal(result.receipt.frameReceipts.length, 3);
const accountAfter = await wallet.balance(), sponsorAfter = await rpc.getBalance({ address: sponsor });
assert.equal(accountAfter, accountBefore); assert(sponsorAfter < sponsorBefore);
const authorizedBody = cacheBody as Record<string, string>;
const original = decodeFrameTransaction(sentRaw);
const malformedFrames = [...original.frames];
malformedFrames[1] = new Frame({ ...malformedFrames[1]!, target: owner });
const malformed = new FrameTx({ ...original, frames: malformedFrames });
const rejected = await fetcher('/api/pq/cache', { method: 'POST', body: JSON.stringify({ ...authorizedBody, raw: malformed.raw() }) });
assert.equal(rejected.status, 400);
const changedFrames = [...original.frames]; changedFrames[2] = new Frame({ ...changedFrames[2]!, value: 1n });
const changed = new FrameTx({ ...original, nonceSeq: original.nonceSeq + 1n, frames: changedFrames });
const invalidSignature = await fetcher('/api/pq/cache', { method: 'POST', body: JSON.stringify({ ...authorizedBody, raw: changed.raw() }) });
assert.equal(invalidSignature.status, 400);
const replay = await rpc.request({ method: 'ethrex_simulateFrameTransaction', params: [sentRaw, 'latest'] } as never) as FrameSimulation;
assert.throws(() => assertSuccessfulSimulation(replay, 3));
wallet.lock();
const restored = await PqAccountClient.restore(readFileSync(path('backup.json'), 'utf8'), transport, { ...options, fetch: async () => { throw Error('Recovery must not require a provisioning service.'); } });
assert.equal(restored.address, wallet.address);
save('evidence.json', { checkedAt: new Date().toISOString(), scope: 'Explicit direct RPC; anonymous browser flow tested separately', chainId: manifest.chainId, account: wallet.address, paymaster: sponsor, transactionHash: result.hash, nativeFrames: 3, accountBalanceBeforeWei: String(accountBefore), accountBalanceAfterWei: String(accountAfter), paymasterBalanceBeforeWei: String(sponsorBefore), paymasterBalanceAfterWei: String(sponsorAfter), accountDeploymentVerified: true, exactRuntimeBytes: 120, backupRestoredWithoutHelper: true, malformedPaymentRejected: true, changedIntentSignatureRejected: true, replayRejected: true });
restored.lock();
console.log('PASS deployed account, funded paymaster gas debit, unchanged principal, three successful frames, helper-free backup recovery and three negative checks.');
