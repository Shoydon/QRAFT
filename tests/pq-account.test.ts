import { expect, test } from 'bun:test';
import { bytesToHex, encodeAbiParameters, keccak256, numberToHex, type Hex } from 'viem';
import { createKey } from '../packages/pq-account/src/keys';
import { decodeFrameTransaction } from '../packages/frame-account/src/frametx';
import realManifest from '../public/pq-deployment.json';
import { derivePqAccount, PqAccountClient, verifyProvisionedPqAccount, type PqAccountDeployment, type PublicJournalStorage, type PqFetch } from '../src/lib/pq/account';
import type { ChainTransport } from '../src/lib/transport/types';

const genesis = realManifest.genesisHash;
const blockHash = `0x${'ab'.repeat(32)}` as Hex;
const rowAddresses = [1, 2, 3, 4].map(i => numberToHex(1000 + i, { size: 20 }));
const descriptor = numberToHex(2000, { size: 20 });
class MemoryJournal implements PublicJournalStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function fixture() {
  const key = createKey(new Uint8Array(32).fill(44)); // Public test-only deterministic vector.
  const publicKey = bytesToHex(key.publicKey);
  const deployment: PqAccountDeployment = {
    ...realManifest,
    contracts: Object.fromEntries(Object.entries(realManifest.contracts).map(([name, pin]) => [name, { address: pin.address, runtimeHash: keccak256('0x6000') }])) as PqAccountDeployment['contracts'],
  };
  const account = derivePqAccount(publicKey, rowAddresses, descriptor, deployment);
  const codes = new Map<string, Hex>(Object.values(deployment.contracts).map(pin => [pin.address.toLowerCase(), '0x6000']));
  for (const row of account.rows) codes.set(row.address.toLowerCase(), row.runtime);
  codes.set(descriptor.toLowerCase(), account.descriptorRuntime); codes.set(account.address.toLowerCase(), account.runtime);
  const state = { nonce: 0n, sent: [] as Hex[], receipt: false, sendFailure: false, missingFrame: false, payer: account.address, chainId: deployment.chainId, alteredFactory: false };
  const methods: string[] = [];
  const transport: ChainTransport = {
    getStatus: () => ({ phase: 'ready', network: 'test', detail: null, code: null, lastLatencyMs: 0, requestCount: methods.length }),
    subscribe: () => () => {}, start() {}, stop() {},
    async request<T>(method: string, params: unknown[] = []): Promise<T> {
      methods.push(method);
      if (method === 'eth_chainId') return numberToHex(state.chainId) as T;
      if (method === 'eth_getBlockByNumber') return { hash: params[0] === '0x0' ? genesis : params[0] === numberToHex(deployment.anchorBlock) ? deployment.anchorHash : blockHash } as T;
      if (method === 'eth_getCode') return (codes.get(String(params[0]).toLowerCase()) ?? '0x') as T;
      if (method === 'eth_call') return encodeAbiParameters([{ type: 'address' }], [state.alteredFactory ? numberToHex(3000, { size: 20 }) : account.address]) as T;
      if (method === 'eth_getStorageAt') return numberToHex(state.nonce, { size: 32 }) as T;
      if (method === 'eth_getBalance') return '0x100000000000000' as T;
      if (method === 'ethrex_simulateFrameTransaction') return { valid: true, prefixShape: 'test', payer: account.address, maxCost: '0x1', violation: null, gasUsed: '0x1', frames: [{ gasUsed: '0x1', succeeded: true }, { gasUsed: '0x1', succeeded: true }], executionStatus: 'success', executionError: null } as T;
      if (method === 'eth_sendRawTransaction') {
        const raw = params[0] as Hex; state.sent.push(raw);
        if (state.sendFailure) throw Error('Lost network acknowledgement');
        state.receipt = true; state.nonce += 1n; return keccak256(raw) as T;
      }
      if (method === 'eth_getTransactionReceipt') {
        if (!state.receipt) return null as T;
        return { type: '0x6', status: '0x1', transactionHash: params[0], from: account.address, payer: state.payer, blockNumber: '0x123', blockHash, gasUsed: '0x100', logs: [], frameReceipts: state.missingFrame ? [{ status: '0x1' }] : [{ status: '0x1' }, { status: '0x1' }] } as T;
      }
      throw Error(`Unexpected test RPC ${method}`);
    },
  };
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher: PqFetch = async (input, init) => {
    const path = String(input); const body = JSON.parse(String(init?.body)) as Record<string, unknown>; posts.push({ path, body });
    return Response.json(path === '/api/pq/accounts' ? account : { hash: keccak256(body.raw as Hex) });
  };
  const journal = new MemoryJournal();
  const options = { seed: new Uint8Array(32).fill(44), fetch: fetcher, deployment, journalStorage: journal, withLock: async <T>(_name: string, operation: () => Promise<T>) => operation() };
  return { key, publicKey, deployment, account, codes, state, methods, transport, posts, journal, options };
}

test('provisioning independently binds public key rows, descriptor, clone and CREATE2 account', async () => {
  const f = fixture();
  const actual = await verifyProvisionedPqAccount(f.publicKey, f.account, f.transport, f.deployment);
  expect(actual.address).toBe(f.account.address);
  f.state.alteredFactory = true;
  await expect(verifyProvisionedPqAccount(f.publicKey, f.account, f.transport, f.deployment)).rejects.toThrow('CREATE2');
});
test('substituted ownership bytes or live prepared-key code are rejected', async () => {
  const f = fixture();
  const wrong = { ...f.account, cloneArgs: `0x${'00'.repeat(75)}` };
  await expect(verifyProvisionedPqAccount(f.publicKey, wrong, f.transport, f.deployment)).rejects.toThrow('bound');
  f.codes.set(f.account.rows[0]!.address.toLowerCase(), '0x6000');
  await expect(verifyProvisionedPqAccount(f.publicKey, f.account, f.transport, f.deployment)).rejects.toThrow('live PQ');
});
test('provisioning refuses a different chain or changed pinned infrastructure', async () => {
  const f = fixture(); f.state.chainId = 1337;
  await expect(verifyProvisionedPqAccount(f.publicKey, f.account, f.transport, f.deployment)).rejects.toThrow('network');
  f.state.chainId = 8141; f.codes.set(f.deployment.contracts.validator.address.toLowerCase(), '0x6001');
  await expect(verifyProvisionedPqAccount(f.publicKey, f.account, f.transport, f.deployment)).rejects.toThrow('pinned');
});
test('backup acknowledgement gates signing and only public material reaches the helper/journal', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options);
  const request = { to: realManifest.pool as Hex, data: '0x1234' as Hex, value: 10n };
  expect((await client.send(request)).kind).toBe('not-sent');
  expect(f.state.sent.length).toBe(0);
  const backup = client.backup(); const seed = JSON.parse(backup).seed as string;
  client.markBackedUp(); const result = await client.send(request);
  expect(result.kind).toBe('confirmed');
  expect(f.posts[0]!.body).toEqual({ publicKey: client.publicKey });
  expect(f.posts.every(post => !JSON.stringify(post.body).includes(seed))).toBe(true);
  const raw = decodeFrameTransaction(f.state.sent[0]!);
  expect(raw.chainId).toBe(8141n); expect(raw.frames[0]!.flags).toBe(3); expect(raw.signatures.length).toBe(0);
  expect(f.journal.values.size).toBe(0); client.lock(); expect(client.isLocked).toBe(true);
  expect(() => client.backup()).toThrow('Unlock');
});
test('unknown submission freezes one public intent across reload and reconciles without a new nonce', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options); const backup = client.backup(); client.markBackedUp();
  f.state.sendFailure = true;
  const result = await client.send({ to: realManifest.pool as Hex, data: '0x1234', timeoutMs: 0 });
  expect(result.kind).toBe('unknown'); const raw = f.state.sent[0]!;
  expect((await client.send({ to: realManifest.pool as Hex, data: '0x9999' })).kind).toBe('not-sent');
  const restored = await PqAccountClient.restore(backup, f.transport, { ...f.options });
  expect(restored.pending?.hash).toBe(keccak256(raw));
  f.state.receipt = true; f.state.nonce = 1n;
  expect((await restored.reconcile()).kind).toBe('confirmed'); expect(f.state.sent.length).toBe(1);
});
test('missing native frame evidence remains unknown and preserves the frozen journal', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options); client.markBackedUp(); f.state.missingFrame = true;
  expect((await client.send({ to: realManifest.pool as Hex, data: '0x1234' })).kind).toBe('unknown');
  expect(client.pending).not.toBeNull();
});
test('backup import rejects silent classical algorithms and mismatched seed/public-key ownership', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options); const backup = JSON.parse(client.backup());
  await expect(PqAccountClient.restore(JSON.stringify({ ...backup, algorithm: 'ECDSA' }), f.transport, f.options)).rejects.toThrow('format');
  await expect(PqAccountClient.restore(JSON.stringify({ ...backup, publicKey: `0x${'00'.repeat(1312)}` }), f.transport, f.options)).rejects.toThrow('does not match');
});

test('wallet backup restores from immutable chain bytes without a provisioning service', async () => {
  const f = fixture(); const original = await PqAccountClient.create(f.transport, f.options); const backup = original.backup();
  const calls = f.posts.length;
  const restored = await PqAccountClient.restore(backup, f.transport, {
    ...f.options,
    fetch: async () => { throw Error('A provisioning service must not be needed to restore ownership.'); },
  });
  expect(restored.address).toBe(original.address);
  expect(restored.publicKey).toBe(original.publicKey);
  expect(restored.isBackedUp).toBe(true);
  expect(f.posts.length).toBe(calls);
});

test('reconciliation checks its expected hash inside the account lock before any RPC',async()=>{
 const f=fixture();let swap:(()=>void)|undefined;
 const client=await PqAccountClient.create(f.transport,{...f.options,withLock:async<T>(_name:string,operation:()=>Promise<T>)=>{swap?.();return operation();}});client.markBackedUp();f.state.sendFailure=true;
 await client.send({to:realManifest.pool as Hex,data:'0x1234',timeoutMs:0});
 const saved=new Map(f.journal.values);const expectedHash=client.pending!.hash;
 f.journal.values.clear();await client.send({to:realManifest.pool as Hex,data:'0x9999',timeoutMs:0});
 const other=new Map(f.journal.values);f.journal.values.clear();for(const[k,v]of saved)f.journal.values.set(k,v);
 swap=()=>{f.journal.values.clear();for(const[k,v]of other)f.journal.values.set(k,v);};
 f.methods.length=0;const sent=f.state.sent.length;
 await expect(client.reconcile({expectedHash})).rejects.toThrow('changed while waiting');
 expect(f.methods).toEqual([]);expect(f.state.sent.length).toBe(sent);expect(client.pending!.hash).not.toBe(expectedHash);
});
