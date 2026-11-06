import { expect, test } from 'bun:test';
import { bytesToHex, encodeAbiParameters, keccak256, numberToHex, type Hex } from 'viem';
import { createKey } from '../packages/pq-account/src/keys';
import { decodeFrameTransaction } from '../packages/frame-account/src/frametx';
import realManifest from '../public/pq-deployment.json';
import { derivePqAccount, PqAccountClient, verifyPqDeployment, verifyProvisionedPqAccount, type PqAccountDeployment, type PublicJournalStorage, type PqFetch } from '../src/lib/pq/account';
import type { ChainTransport } from '../src/lib/transport/types';

const genesis = realManifest.genesisHash;
const blockHash = `0x${'ab'.repeat(32)}` as Hex;
const rowAddresses = [1, 2, 3, 4].map(i => numberToHex(1000 + i, { size: 20 }));
const descriptor = numberToHex(2000, { size: 20 });
const sponsor = numberToHex(3000, { size: 20 });
class MemoryJournal implements PublicJournalStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function fixture(chainId = 8141) {
  const key = createKey(new Uint8Array(32).fill(44)); // Public test-only deterministic vector.
  const publicKey = bytesToHex(key.publicKey);
  const contracts = Object.fromEntries(Object.entries(realManifest.contracts).map(([name, pin]) => [name, { address: pin.address, runtimeHash: keccak256('0x6000') }])) as PqAccountDeployment['contracts'];
  const deployment: PqAccountDeployment = {
    ...realManifest, chainId,
    applicationEnabled: true,
    contracts: { ...contracts, paymaster: { address: sponsor, runtimeHash: keccak256('0x6000') } },
  };
  const account = derivePqAccount(publicKey, rowAddresses, descriptor, deployment);
  const codes = new Map<string, Hex>(Object.values(deployment.contracts).map(pin => [pin.address.toLowerCase(), '0x6000']));
  for (const row of account.rows) codes.set(row.address.toLowerCase(), row.runtime);
  codes.set(descriptor.toLowerCase(), account.descriptorRuntime); codes.set(account.address.toLowerCase(), account.runtime);
  const state = { nonce: 0n, sent: [] as Hex[], receipt: false, sendFailure: false, missingFrame: false, payer: sponsor, simulationPayer: sponsor, chainId: deployment.chainId, alteredFactory: false };
  let simulatedRaw: Hex | null = null;
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
      if (method === 'ethrex_simulateFrameTransaction') { simulatedRaw = params[0] as Hex; return { valid: true, prefixShape: 'test', payer: state.simulationPayer, maxCost: '0x1', violation: null, gasUsed: '0x1', frames: Array.from({length:3},()=>({ gasUsed: '0x1', succeeded: true })), executionStatus: 'success', executionError: null } as T; }
      if (method === 'eth_sendRawTransaction' || method === 'eth_sendFrameTransaction') {
        const raw = method === 'eth_sendFrameTransaction' ? simulatedRaw! : params[0] as Hex; state.sent.push(raw);
        if (state.sendFailure) throw Error('Lost network acknowledgement');
        state.receipt = true; state.nonce += 1n; return keccak256(raw) as T;
      }
      if (method === 'eth_getTransactionReceipt') {
        if (!state.receipt) return null as T;
        return { type: '0x6', status: '0x1', transactionHash: params[0], from: account.address, payer: state.payer, blockNumber: '0x123', blockHash, gasUsed: '0x100', logs: [], frameReceipts: state.missingFrame ? [{ status: '0x1' }] : Array.from({length:3},()=>({ status: '0x1' })) } as T;
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
test('an unlocked wallet signs without backup acknowledgement and sends only public material', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options);
  const request = { to: realManifest.pool as Hex, data: '0x1234' as Hex, value: 10n };
  const backup = client.backup(); const seed = JSON.parse(backup).seed as string;
  const result = await client.send(request);
  expect(result.kind).toBe('confirmed');
  expect(f.posts[0]!.body).toEqual({ publicKey: client.publicKey });
  expect(f.posts.every(post => !JSON.stringify(post.body).includes(seed))).toBe(true);
  const raw = decodeFrameTransaction(f.state.sent[0]!);
  expect(raw.chainId).toBe(8141n); expect(raw.frames[0]!.flags).toBe(2); expect(raw.frames[1]!.flags).toBe(1); expect(raw.frames[1]!.target).toBe(sponsor); expect(raw.frames.length).toBe(3); expect(raw.signatures.length).toBe(0);
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

test('wallet recovery shows one simple status and never provisions another account', async () => {
  const f = fixture(); const original = await PqAccountClient.create(f.transport, f.options);
  const stages: string[] = []; const posts = f.posts.length;
  const restored = await PqAccountClient.restore(original.backup(), f.transport, { ...f.options, onProgress: stage => stages.push(stage) });
  expect(stages).toEqual(['Opening your wallet…']);
  expect(f.posts.length).toBe(posts); original.lock(); restored.lock();
});

test('local passkey unlock does no RPC reads but rejects a substituted account before signing', async () => {
  const f = fixture(); const original = await PqAccountClient.create(f.transport, f.options);
  const before = f.methods.length;
  const restored = await PqAccountClient.restore(original.backup(), f.transport, { ...f.options, deferNetworkVerification: true });
  expect(restored.address).toBe(original.address);
  expect(f.methods.length).toBe(before);
  f.codes.set(f.account.address.toLowerCase(), '0x6000');
  expect((await restored.send({ to: sponsor, data: '0x' })).kind).toBe('not-sent');
  expect(f.state.sent.length).toBe(0); original.lock(); restored.lock();
});

test('deployment transaction metadata is exposed without changing the derived account', async () => {
  const f = fixture(); const hash = `0x${'ab'.repeat(32)}` as Hex;
  const account = await verifyProvisionedPqAccount(f.publicKey, { ...f.account, deploymentTransactionHash: hash }, f.transport, f.deployment);
  expect(account.deploymentTransactionHash).toBe(hash);
  expect(account.address).toBe(f.account.address);
  await expect(verifyProvisionedPqAccount(f.publicKey, { ...f.account, deploymentTransactionHash: 'bad' }, f.transport, f.deployment)).rejects.toThrow('transaction hash');
});

test('stalled wallet recovery times out and ignores a late RPC response', async () => {
  const f = fixture(); const original = await PqAccountClient.create(f.transport, f.options);
  let release!: () => void; const stalled = new Promise<void>(resolve => { release = resolve; });
  let calls = 0; const stages: string[] = [];
  const transport: ChainTransport = { ...f.transport, async request<T>(method: string, params?: unknown[]) {
    calls++; await stalled; return f.transport.request<T>(method, params);
  } };
  await expect(PqAccountClient.restore(original.backup(), transport, { ...f.options, verificationTimeoutMs: 10, onProgress: stage => stages.push(stage) })).rejects.toThrow('anonymous network verification timed out');
  expect(calls).toBe(1); expect(stages.length).toBe(1);
  release(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(calls).toBe(1); expect(stages.length).toBe(1); original.lock();
});

test('reconciliation checks its expected hash inside the account lock before any RPC',async()=>{
 const f=fixture();const lockState:{swap?:(()=>void)}={};
 const client=await PqAccountClient.create(f.transport,{...f.options,withLock:async<T>(_name:string,operation:()=>Promise<T>)=>{lockState.swap?.();return operation();}});client.markBackedUp();f.state.sendFailure=true;
 await client.send({to:realManifest.pool as Hex,data:'0x1234',timeoutMs:0});
 const saved=new Map(f.journal.values);const expectedHash=client.pending!.hash;
 f.journal.values.clear();await client.send({to:realManifest.pool as Hex,data:'0x9999',timeoutMs:0});
 const other=new Map(f.journal.values);f.journal.values.clear();for(const[k,v]of saved)f.journal.values.set(k,v);
 lockState.swap=()=>{f.journal.values.clear();for(const[k,v]of other)f.journal.values.set(k,v);};
 f.methods.length=0;const sent=f.state.sent.length;
 await expect(client.reconcile({expectedHash})).rejects.toThrow('changed while waiting');
 expect(f.methods).toEqual([]);expect(f.state.sent.length).toBe(sent);expect(client.pending!.hash).not.toBe(expectedHash);
});


test('a deployment awaiting the QRAFT namespace migration rejects before any RPC or submission', async () => {
  const f = fixture();
  await expect(verifyPqDeployment(f.transport, { ...realManifest, applicationEnabled: false, deploymentNote: undefined })).rejects.toThrow('fresh deployment');
  expect(f.methods).toHaveLength(0);
  expect(f.state.sent).toHaveLength(0);
});


test('a different simulation gas payer cannot cause a sponsored broadcast', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options); client.markBackedUp();
  f.state.simulationPayer = f.account.address;
  const result = await client.send({ to: realManifest.pool as Hex, data: '0x1234', timeoutMs: 0 });
  expect(result.kind).toBe('unknown');
  expect(f.state.sent).toHaveLength(0);
  expect(client.pending).not.toBeNull();
});

test('a receipt charging the user instead of the paymaster cannot confirm the intent', async () => {
  const f = fixture(); const client = await PqAccountClient.create(f.transport, f.options); client.markBackedUp();
  f.state.payer = f.account.address;
  const result = await client.send({ to: realManifest.pool as Hex, data: '0x1234', timeoutMs: 0 });
  expect(result.kind).toBe('unknown');
  expect(f.state.sent).toHaveLength(1);
  expect(client.pending).not.toBeNull();
});


test('account deployment polls a public setup job without submitting another key', async () => {
  const f = fixture(); let posts = 0; let polls = 0; const stages: string[] = [];
  const id = keccak256(f.publicKey);
  const fetcher: PqFetch = async (_input, init) => {
    if (init?.method === 'POST') { posts++; expect(JSON.parse(String(init.body))).toEqual({ publicKey: f.publicKey }); return Response.json({ id, publicKey: f.publicKey, status: 'provisioning', stage: 'Deploying public key row 1 of 4' }, { status: 202 }); }
    polls++; return Response.json({ id, publicKey: f.publicKey, status: 'ready', stage: 'Smart account deployed', account: f.account });
  };
  const client = await PqAccountClient.create(f.transport, { ...f.options, fetch: fetcher, onProgress: stage => stages.push(stage) });
  expect(client.address).toBe(f.account.address); expect(posts).toBe(1); expect(polls).toBe(1);
  expect(stages).toEqual(['Generating your signing key locally', 'Deploying public key row 1 of 4', 'Smart account deployed', 'Verifying your deployed smart account']); client.lock();
});

test('interrupted setup can retry the same seed without changing the public key', async () => {
  const f = fixture(); const keys: string[] = []; let failed = true;
  const fetcher: PqFetch = async (_input, init) => {
    keys.push(JSON.parse(String(init?.body)).publicKey);
    return Response.json(failed ? { id: keccak256(f.publicKey), publicKey: f.publicKey, status: 'failed', error: 'Account setup was interrupted' } : f.account);
  };
  await expect(PqAccountClient.create(f.transport, { ...f.options, fetch: fetcher })).rejects.toThrow('interrupted');
  failed = false; const client = await PqAccountClient.create(f.transport, { ...f.options, fetch: fetcher });
  expect(keys).toEqual([f.publicKey, f.publicKey]); expect(f.options.seed.every(byte => byte === 44)).toBe(true); client.lock();
});

test('a queued setup for another key is rejected before polling or chain reads', async () => {
  const f = fixture(); let requests = 0;
  const fetcher: PqFetch = async () => {
    requests++;
    return Response.json({ id: numberToHex(1234, { size: 32 }), publicKey: f.publicKey, status: 'provisioning', stage: 'Waiting' }, { status: 202 });
  };
  await expect(PqAccountClient.create(f.transport, { ...f.options, fetch: fetcher })).rejects.toThrow('another account setup');
  expect(requests).toBe(1); expect(f.methods).toEqual([]);
});

test('legacy backup acknowledgement metadata does not block unlocked signing', async () => {
  const f = fixture(); const original = await PqAccountClient.create(f.transport, f.options);
  const restored = await PqAccountClient.restore(original.backup(), f.transport, { ...f.options, backupAcknowledged: false });
  expect(restored.isBackedUp).toBe(false);
  expect((await restored.send({ to: sponsor, data: '0x' })).kind).toBe('confirmed');
  expect(f.state.sent.length).toBe(1);
  original.lock(); restored.lock();
});

test('EF wallet carries PQ signature in VERIFY transaction and never calls cache helper', async () => {
  const f = fixture(1337); const client = await PqAccountClient.create(f.transport, f.options);
  const result = await client.send({ to: realManifest.pool as Hex, data: '0x1234', timeoutMs: 1000 });
  expect(result.kind).toBe('confirmed');
  expect(f.methods).toContain('eth_sendFrameTransaction');
  expect(f.methods).not.toContain('eth_sendRawTransaction');
  expect(f.posts.some(post => post.path === '/api/pq/cache')).toBe(false);
  const tx = decodeFrameTransaction(f.state.sent[0]!);
  expect(tx.signatures).toHaveLength(1);
  expect(tx.signatures[0]!.signature).toHaveLength(4842);
  expect(tx.frames[0]!.gasLimit).toBe(2200000n);
});
