/** Browser signing client; exported account verification/recovery consumes public data only. */

import { bytesToHex, concat, decodeFunctionResult, encodeFunctionData, encodePacked, getCreate2Address, hexToBytes, keccak256, numberToHex, parseAbi, type Hex } from 'viem';
import { createKey, preparePublicKey, signAuthorization, verifyAuthorization, type PQKey } from '../../../packages/pq-account/src/keys';
import { Frame, FrameMode, FrameTx, NONCE_MANAGER_LEGACY, assertSuccessfulReceipt, assertSuccessfulSimulation, decodeFrameTransaction, nonceSlot, type FrameReceipt, type FrameSimulation } from '../../../packages/frame-account/src/frametx';
import manifest from '../../../public/pq-deployment.json';
import { PQ_POOLS } from './registry';
import type { ChainTransport } from '../transport/types';

const VERIFY_ABI = parseAbi(['function verify(bytes data)']);
const PAY_ABI = parseAbi(['function pay()']);
export const PQ_FRAME_COUNT = 3;
export const PQ_EXECUTION_FRAME = 2;
const FACTORY_ABI = parseAbi(['function predict(address implementation,bytes args,bytes32 salt) view returns(address)']);
const KEY_BYTES = 1312;
const JOURNAL_VERSION = 2;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isHex = (value: unknown, bytes: number): value is Hex => typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
const wholeHex = (value: unknown): value is Hex => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);
const quantityHex = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value);
function failure(message: string): never { throw Error(message); }

export interface PqAccountDeployment {
  applicationEnabled?: boolean;
  chainId: number;
  genesisHash: string;
  anchorBlock: number;
  anchorHash: string;
  contracts: Record<string, { address: string; runtimeHash: string }> & {
    factory: { address: string; runtimeHash: string };
    implementation: { address: string; runtimeHash: string };
    validator: { address: string; runtimeHash: string };
  };
}
export interface VerifiedPqAccount {
  publicKey: Hex;
  address: Hex;
  descriptor: Hex;
  descriptorRuntime: Hex;
  rows: { address: Hex; runtime: Hex }[];
  cloneArgs: Hex;
  salt: Hex;
  runtime: Hex;
}

export function pqPaymaster(deployment: PqAccountDeployment = manifest): Hex {
  const pin = deployment.contracts.paymaster;
  if (!pin || !isHex(pin.address, 20) || BigInt(pin.address) === 0n) failure('The QRAFT gas paymaster is not configured.');
  return pin.address;
}

function registeredSponsor(address: Hex, deployment: PqAccountDeployment): boolean {
  return equal(address, pqPaymaster(deployment)) || (deployment === manifest && PQ_POOLS.some(pool => equal(pool.paymaster, address)));
}
function transactionSponsor(tx: FrameTx, deployment: PqAccountDeployment): Hex {
  const sponsor = tx.frames[1]?.target;
  if (!sponsor || !registeredSponsor(sponsor, deployment)) failure('Unregistered PQ transaction paymaster.');
  return sponsor;
}

export function assertSponsoredPqTransaction(tx: FrameTx, deployment: PqAccountDeployment = manifest): void {
  const [authorization, payment, execution] = tx.frames;
  if (tx.chainId !== BigInt(deployment.chainId) || tx.nonceKeys.length !== 1 || tx.nonceKeys[0] !== BigInt(deployment.contracts.validator.address) || tx.nonceSeq >= 1000n || tx.signatures.length !== 0 || tx.maxFee > 128n || tx.maxPriorityFee > 1n || tx.maxBlobFee !== 0n || tx.blobHashes.length !== 0 || tx.frames.length !== PQ_FRAME_COUNT ||
    !authorization || authorization.mode !== FrameMode.VERIFY || authorization.flags !== 2 || authorization.target !== tx.sender || authorization.value !== 0n || authorization.gasLimit > 180000n || authorization.stateGasLimit !== 0n || authorization.data !== encodeFunctionData({ abi: VERIFY_ABI, functionName: 'verify', args: ['0x'] }) ||
    !payment || payment.mode !== FrameMode.VERIFY || payment.flags !== 1 || !payment.target || !registeredSponsor(payment.target, deployment) || payment.value !== 0n || payment.gasLimit > 120000n || payment.stateGasLimit > 97920n || payment.data !== encodeFunctionData({ abi: PAY_ABI, functionName: 'pay' }) ||
    !execution || execution.mode !== FrameMode.SENDER || execution.flags !== 0 || execution.gasLimit > 14500000n || execution.stateGasLimit > 40000000n || execution.data.length > 250002) failure('Unsupported sponsored PQ transaction.');
}

/** Derive every key/configuration byte independently of the provisioning server. */
export function derivePqAccount(publicKey: Hex, rowAddresses: readonly Hex[], descriptor: Hex,
  deployment: PqAccountDeployment = manifest,
): VerifiedPqAccount {
  if (!isHex(publicKey, KEY_BYTES) || rowAddresses.length !== 4 || rowAddresses.some(row => !isHex(row, 20)) || !isHex(descriptor, 20)) failure('Invalid public ML-DSA account configuration.');
  const prepared = preparePublicKey(hexToBytes(publicKey));
  const rows = rowAddresses.map((address, i) => ({
    address,
    runtime: bytesToHex(new Uint8Array([0, ...prepared.slice(4161 + i * 4096, 4161 + (i + 1) * 4096), ...prepared.slice(65 + i * 1024, 65 + (i + 1) * 1024)])),
  }));
  const descriptorRuntime = concat(['0x00', bytesToHex(prepared.slice(1, 65)), ...rows.flatMap(row => [row.address, keccak256(row.runtime)])]);
  const cloneArgs = encodePacked(['address', 'uint8', 'uint8', 'uint8', 'address', 'bytes32'],
    [deployment.contracts.validator.address as Hex, 2, 15, 0, descriptor, keccak256(descriptorRuntime)]);
  const salt = keccak256(publicKey);
  const runtime = concat(['0x363d3d373d3d3d363d73', deployment.contracts.implementation.address as Hex, '0x5af43d82803e903d91602b57fd5bf3', cloneArgs]);
  // Exact CREATE2 initcode from the pinned ERC8286AccountFactory (OZ immutable-args clone).
  const initcode = concat(['0x61', numberToHex((cloneArgs.length - 2) / 2 + 45, { size: 2 }),
    '0x3d81600a3d39f3363d3d373d3d3d363d73', deployment.contracts.implementation.address as Hex,
    '0x5af43d82803e903d91602b57fd5bf3', cloneArgs]);
  const address = getCreate2Address({ from: deployment.contracts.factory.address as Hex, salt, bytecode: initcode });
  return { publicKey, address, descriptor, descriptorRuntime, rows, cloneArgs, salt, runtime };
}

export async function verifyPqDeployment(transport: ChainTransport, deployment: PqAccountDeployment = manifest): Promise<void> {
  if (deployment.applicationEnabled === false) failure('The QRAFT protocol requires a fresh deployment. Transactions are disabled.');
  pqPaymaster(deployment);
  const [chainId, genesis, anchor] = await Promise.all([
    transport.request<Hex>('eth_chainId'),
    transport.request<{ hash: Hex }>('eth_getBlockByNumber', ['0x0', false]),
    transport.request<{ hash: Hex }>('eth_getBlockByNumber', [numberToHex(deployment.anchorBlock), false]),
  ]);
  if (!quantityHex(chainId) || BigInt(chainId) !== BigInt(deployment.chainId) || !genesis || !anchor || !equal(genesis.hash, deployment.genesisHash) || !equal(anchor.hash, deployment.anchorHash)) failure('The PQ network identity changed. Do not submit a transaction.');
  await Promise.all(Object.values(deployment.contracts).map(async pin => {
    const code = await transport.request<Hex>('eth_getCode', [pin.address, 'latest']);
    if (!wholeHex(code) || code === '0x' || !equal(keccak256(code), pin.runtimeHash)) failure('A pinned PQ contract changed. Transactions are disabled.');
  }));
  const sponsorBalance = await transport.request<Hex>('eth_getBalance', [pqPaymaster(deployment), 'latest']);
  if (!quantityHex(sponsorBalance) || BigInt(sponsorBalance) < 1000000000000n) failure('The QRAFT paymaster needs test ETH before transactions can be sponsored.');
}

export async function verifyProvisionedPqAccount(publicKey: Hex, supplied: unknown, transport: ChainTransport,
  deployment: PqAccountDeployment = manifest,
): Promise<VerifiedPqAccount> {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) failure('The provisioning response is invalid.');
  const response = supplied as Record<string, unknown>;
  const allowed = ['publicKey', 'address', 'descriptor', 'descriptorRuntime', 'rows', 'cloneArgs', 'salt', 'runtime'];
  if (Object.keys(response).length !== allowed.length || Object.keys(response).some(key => !allowed.includes(key)) ||
    !isHex(response.publicKey, KEY_BYTES) || !equal(response.publicKey, publicKey) || !isHex(response.address, 20) || !isHex(response.descriptor, 20) || !Array.isArray(response.rows) || response.rows.length !== 4) failure('The provisioning response does not match your public key.');
  const rowAddresses = (response.rows as unknown[]).map(row => {
    if (!row || typeof row !== 'object' || !('address' in row) || !isHex(row.address, 20)) failure('Invalid prepared-key row.');
    return (row as { address: Hex }).address;
  });
  const expected = derivePqAccount(publicKey, rowAddresses, response.descriptor as Hex, deployment);
  for (const field of ['publicKey', 'address', 'descriptor', 'descriptorRuntime', 'cloneArgs', 'salt', 'runtime'] as const) {
    if (typeof response[field] !== 'string' || !equal(response[field] as string, expected[field])) failure('The provisioned account is not bound to your ML-DSA key.');
  }
  for (let i = 0; i < 4; i++) {
    const row = (response.rows as Record<string, unknown>[])[i]!;
    if (Object.keys(row).length !== 2 || !wholeHex(row.runtime) || !equal(row.runtime, expected.rows[i]!.runtime)) failure('A prepared-key row differs from your public key.');
  }
  await verifyPqDeployment(transport, deployment);
  await Promise.all([...expected.rows, { address: expected.descriptor, runtime: expected.descriptorRuntime }, { address: expected.address, runtime: expected.runtime }].map(async row => {
    const actual = await transport.request<Hex>('eth_getCode', [row.address, 'latest']);
    if (!wholeHex(actual) || !equal(actual, row.runtime)) failure('The live PQ account/key bytes do not match the independently derived configuration.');
  }));
  const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: 'predict', args: [deployment.contracts.implementation.address as Hex, expected.cloneArgs, expected.salt] });
  const answer = await transport.request<Hex>('eth_call', [{ to: deployment.contracts.factory.address, data }, 'latest']);
  const predicted = decodeFunctionResult({ abi: FACTORY_ABI, functionName: 'predict', data: answer });
  if (!equal(predicted, expected.address)) failure('The factory prediction differs from the local CREATE2 derivation.');
  return expected;
}

/** Recover immutable account configuration directly from public chain bytes. */
export async function recoverProvisionedPqAccount(publicKey: Hex, address: Hex, transport: ChainTransport,
  deployment: PqAccountDeployment = manifest,
): Promise<VerifiedPqAccount> {
  if (!isHex(publicKey, KEY_BYTES) || !isHex(address, 20)) failure('Invalid public PQ recovery identity.');
  const runtime = await transport.request<Hex>('eth_getCode', [address, 'latest']);
  const prefix = concat(['0x363d3d373d3d3d363d73', deployment.contracts.implementation.address as Hex, '0x5af43d82803e903d91602b57fd5bf3']);
  if (!wholeHex(runtime) || runtime.length !== prefix.length + 150 || !runtime.toLowerCase().startsWith(prefix.toLowerCase())) failure('The backed-up address is not the expected immutable PQ account.');
  const args = runtime.slice(prefix.length);
  const descriptor = `0x${args.slice(46, 86)}` as Hex;
  const descriptorRuntime = await transport.request<Hex>('eth_getCode', [descriptor, 'latest']);
  if (!isHex(descriptorRuntime, 273)) failure('The PQ key descriptor is unavailable.');
  const descriptorBytes = descriptorRuntime.slice(2);
  const rowAddresses = Array.from({ length: 4 }, (_, i) => `0x${descriptorBytes.slice((65 + i * 52) * 2, (65 + i * 52 + 20) * 2)}` as Hex);
  const expected = derivePqAccount(publicKey, rowAddresses, descriptor, deployment);
  if (!equal(expected.address, address) || !equal(expected.runtime, runtime) || !equal(expected.descriptorRuntime, descriptorRuntime)) failure('The backed-up account is not bound to this ML-DSA public key.');
  return verifyProvisionedPqAccount(publicKey, expected, transport, deployment);
}

export interface PublicJournalStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface PublicTransactionJournal {
  version: 2; chainId: number; genesisHash: string; publicKey: Hex; account: Hex;
  raw: Hex; hash: Hex; authorizationSignature: Hex; cacheReady: boolean;
  state: 'prepared' | 'broadcasting' | 'submitted' | 'unknown';
}
export interface PqRawReceipt extends FrameReceipt {
  from: Hex; transactionHash: Hex; blockNumber: Hex; blockHash: Hex; gasUsed: Hex;
  logs: { address: Hex; topics: Hex[]; data: Hex }[];
}
export type PqSendResult =
  | { kind: 'confirmed'; hash: Hex; receipt: PqRawReceipt }
  | { kind: 'failed'; hash: Hex; receipt: PqRawReceipt; reason: string }
  | { kind: 'unknown'; hash: Hex; reason: string }
  | { kind: 'not-sent'; reason: string };
export interface PqSendOptions { paymaster?: Hex; to: Hex; data: Hex; value?: bigint; onProgress?: (label: string) => void; signal?: AbortSignal; timeoutMs?: number }
export type PqFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface PqAccountClientOptions {
  seed?: Uint8Array;
  fetch?: PqFetch;
  journalStorage?: PublicJournalStorage;
  withLock?: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
  deployment?: PqAccountDeployment;
  onProgress?: (label: string) => void;
}

function browserJournal(): PublicJournalStorage {
  if (typeof window === 'undefined') failure('A durable public transaction journal is required.');
  return window.localStorage;
}
async function browserLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) failure('Web Locks support is required to sign safely across tabs.');
  return navigator.locks.request(name, operation);
}
async function postPublic(fetcher: PqFetch, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) });
  return readPublicResponse(response);
}
async function readPublicResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) failure('The local PQ helper returned no response.');
  const parts: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 131_072) failure('The local PQ helper response is too large.'); parts.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; }
  let result: unknown; try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { failure('The local PQ helper response is invalid.'); }
  if (!response.ok) {
    // The body is already parsed and usually carries the real cause.
    // Dropping it left the interface saying only that something went
    // wrong, which sent us to server logs for a missing file it knew about.
    const reported = (result as { error?: unknown } | null)?.error;
    const detail = typeof reported === 'string' && reported.trim() ? ` ${reported.trim().slice(0, 200)}` : '';
    failure(`The local PQ helper could not complete this operation.${detail} Your key remains on this device.`);
  }
  return result;
}

async function finishAccountSetup(fetcher:PqFetch, initial:unknown, publicKey:Hex, onProgress?:PqAccountClientOptions['onProgress']):Promise<unknown>{
  if(!initial||typeof initial!=='object'||!('status'in initial))return initial;
  let job=initial as Record<string,unknown>;
  const id=keccak256(publicKey),deadline=Date.now()+900000;
  for(;;){
    if(job.id!==id||job.publicKey!==publicKey)failure('The helper returned another account setup.');
    if(typeof job.stage==='string')onProgress?.(job.stage.slice(0,200));
    if(job.status==='ready')return job.account;
    if(job.status==='failed')failure(typeof job.error==='string'?job.error.slice(0,240):'Account deployment stopped. Retry the same wallet setup.');
    if(job.status!=='provisioning'||Date.now()>deadline)failure('Account setup is taking too long. Retry to resume the same wallet.');
    await new Promise<void>(resolve=>setTimeout(resolve,1000));
    const response=await fetcher(`/api/pq/accounts?id=${id}`,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
    const next=await readPublicResponse(response);
    if(!next||typeof next!=='object')failure('The helper returned an invalid account status.');
    job=next as Record<string,unknown>;
  }
}

export class PqAccountClient {
  private key: PQKey | null;
  private backedUp = false;
  private readonly storage: PublicJournalStorage;
  private readonly withLock: NonNullable<PqAccountClientOptions['withLock']>;
  private readonly fetcher: PqFetch;
  private readonly deployment: PqAccountDeployment;
  private readonly journalKey: string;
  readonly account: VerifiedPqAccount;
  private constructor(private readonly transport: ChainTransport, key: PQKey, account: VerifiedPqAccount, options: PqAccountClientOptions) {
    this.key = key; this.account = account;
    this.storage = options.journalStorage ?? browserJournal(); this.withLock = options.withLock ?? browserLock;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.deployment = options.deployment ?? manifest;
    this.journalKey = `qraft:pq-public-tx:v2:${this.deployment.chainId}:${this.account.publicKey.toLowerCase()}`;
    this.readJournal();
  }
  get address(): Hex { return this.account.address; }
  get publicKey(): Hex { return this.account.publicKey; }
  get isBackedUp(): boolean { return this.backedUp; }
  get isLocked(): boolean { return this.key === null; }
  get pending(): { hash: Hex; raw: Hex; state: PublicTransactionJournal['state'] } | null {
    const journal = this.readJournal(); return journal ? { hash: journal.hash, raw: journal.raw, state: journal.state } : null;
  }
  static async create(transport: ChainTransport, options: PqAccountClientOptions = {}): Promise<PqAccountClient> {
    const key = createKey(options.seed);
    try {
      const publicKey = bytesToHex(key.publicKey);
      const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await postPublic(fetcher, '/api/pq/accounts', { publicKey });
      const completed = await finishAccountSetup(fetcher,response,publicKey,options.onProgress);
      const account = await verifyProvisionedPqAccount(publicKey, completed, transport, options.deployment ?? manifest);
      return new PqAccountClient(transport, key, account, options);
    } catch (error) { key.seed.fill(0); throw error; }
  }
  static async restore(text: string, transport: ChainTransport, options: Omit<PqAccountClientOptions, 'seed'> = {}): Promise<PqAccountClient> {
    if (text.length > 8192) failure('The PQ backup is too large.');
    let value: unknown; try { value = JSON.parse(text); } catch { failure('Choose a valid PQ wallet backup.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) failure('Choose a valid PQ wallet backup.');
    const backup = value as Record<string, unknown>; const deployment = options.deployment ?? manifest;
    const keys = ['version', 'algorithm', 'chainId', 'genesisHash', 'publicKey', 'address', 'seed'];
    if (Object.keys(backup).length !== keys.length || Object.keys(backup).some(key => !keys.includes(key)) || backup.version !== 1 || backup.algorithm !== 'ML-DSA-44' || backup.chainId !== deployment.chainId || backup.genesisHash !== deployment.genesisHash || !isHex(backup.seed, 32) || !isHex(backup.publicKey, KEY_BYTES) || !isHex(backup.address, 20)) failure('The PQ backup format or network does not match.');
    const seed = hexToBytes(backup.seed as Hex);
    let key: PQKey | null = null;
    try {
      key = createKey(seed);
      const publicKey = bytesToHex(key.publicKey);
      if (!equal(publicKey, backup.publicKey as string)) failure('The backup key does not match its public key.');
      const account = await recoverProvisionedPqAccount(publicKey, backup.address as Hex, transport, deployment);
      const client = new PqAccountClient(transport, key, account, options);
      client.backedUp = true;
      return client;
    } catch (error) { key?.seed.fill(0); throw error; }
    finally { seed.fill(0); }
  }
  backup(): string {
    if (!this.key) failure('Unlock the PQ wallet before exporting its backup.');
    return JSON.stringify({ version: 1, algorithm: 'ML-DSA-44', chainId: this.deployment.chainId, genesisHash: this.deployment.genesisHash,
      publicKey: this.publicKey, address: this.address, seed: bytesToHex(this.key.seed) });
  }
  markBackedUp(): void { if (!this.key) failure('The PQ wallet is locked.'); this.backedUp = true; }
  lock(): void { this.key?.seed.fill(0); this.key = null; this.backedUp = false; }
  async balance(): Promise<bigint> { return BigInt(await this.transport.request<Hex>('eth_getBalance', [this.address, 'latest'])); }
  private readJournal(): PublicTransactionJournal | null {
    const text = this.storage.getItem(this.journalKey); if (!text) return null;
    if (text.length > 300_000) failure('The public transaction journal is too large. Preserve it for reconciliation.');
    let value: unknown; try { value = JSON.parse(text); } catch { failure('The public transaction journal is damaged. Preserve it for reconciliation.'); }
    if (!value || typeof value !== 'object') failure('The public transaction journal is invalid.');
    const entry = value as PublicTransactionJournal;
    if (entry.version !== JOURNAL_VERSION || entry.chainId !== this.deployment.chainId || entry.genesisHash !== this.deployment.genesisHash || !isHex(entry.publicKey, KEY_BYTES) || !equal(entry.publicKey, this.publicKey) || !isHex(entry.account, 20) || !equal(entry.account, this.address) || !wholeHex(entry.raw) || !isHex(entry.hash, 32) || keccak256(entry.raw) !== entry.hash || !isHex(entry.authorizationSignature, 2420) || !['prepared', 'broadcasting', 'submitted', 'unknown'].includes(entry.state) || typeof entry.cacheReady !== 'boolean') failure('The public transaction journal binding is invalid. Preserve it for reconciliation.');
    const tx = decodeFrameTransaction(entry.raw);
    assertSponsoredPqTransaction(tx, this.deployment);
    if (tx.chainId !== BigInt(this.deployment.chainId) || !equal(tx.sender, this.address) || tx.nonceKeys.length !== 1 || tx.nonceKeys[0] !== BigInt(this.deployment.contracts.validator.address) || !verifyAuthorization(hexToBytes(this.publicKey), tx.sigHash(), entry.authorizationSignature)) failure('The saved transaction does not belong to this PQ account.');
    return entry;
  }
  private saveJournal(entry: PublicTransactionJournal): void { this.storage.setItem(this.journalKey, JSON.stringify(entry)); }
  private async nonce(): Promise<bigint> { return BigInt(await this.transport.request<Hex>('eth_getStorageAt', [NONCE_MANAGER_LEGACY, nonceSlot(this.address, BigInt(this.deployment.contracts.validator.address)), 'latest'])); }
  private async verifyContext(sponsor: Hex = pqPaymaster(this.deployment)): Promise<void> {
    await verifyPqDeployment(this.transport, this.deployment);
    if (!registeredSponsor(sponsor, this.deployment)) failure('Unregistered PQ gas sponsor.');
    if (!equal(sponsor, pqPaymaster(this.deployment))) {
      const pool = PQ_POOLS.find(pool => equal(pool.paymaster, sponsor))!;
      const code = await this.transport.request<Hex>('eth_getCode', [sponsor, 'latest']);
      const funds = await this.transport.request<Hex>('eth_getBalance', [sponsor, 'latest']);
      if (!wholeHex(code) || keccak256(code) !== pool.paymasterRuntimeHash || !quantityHex(funds) || BigInt(funds) < 1000000000000n) failure('The selected pool sponsor changed or needs test ETH.');
    }
    const runtime = await this.transport.request<Hex>('eth_getCode', [this.address, 'latest']);
    if (!equal(runtime, this.account.runtime)) failure('The PQ account changed. No transaction was submitted.');
  }
  async send(options: PqSendOptions): Promise<PqSendResult> {
    return this.withLock(`qraft:pq-sign:${this.deployment.chainId}:${this.address.toLowerCase()}`, async () => {
      if (this.readJournal()) return { kind: 'not-sent', reason: 'Reconcile the saved transaction before creating another intent.' };
      if (!this.key || !this.backedUp) return { kind: 'not-sent', reason: 'Save and acknowledge your PQ wallet backup before signing.' };
      if (!isHex(options.to, 20) || !wholeHex(options.data) || (options.value ?? 0n) < 0n) return { kind: 'not-sent', reason: 'Invalid native transaction request.' };
      try {
        options.signal?.throwIfAborted(); options.onProgress?.('Checking the PQ account and keyed nonce'); await this.verifyContext(options.paymaster);
        const nonce = await this.nonce(); options.signal?.throwIfAborted();
        if (!this.key) failure('The PQ wallet was locked.');
        const tx = new FrameTx({ chainId: this.deployment.chainId, nonceKeys: [BigInt(this.deployment.contracts.validator.address)], nonceSeq: nonce, sender: this.address,
          maxPriorityFee: 1n, maxFee: 128n, signatures: [], frames: [
            new Frame({ mode: FrameMode.VERIFY, flags: 2, target: this.address, gasLimit: 180000n, stateGasLimit: 0n, data: encodeFunctionData({ abi: VERIFY_ABI, functionName: 'verify', args: ['0x'] }) }),
            new Frame({ mode: FrameMode.VERIFY, flags: 1, target: options.paymaster ?? pqPaymaster(this.deployment), gasLimit: 120000n, stateGasLimit: 97920n, data: encodeFunctionData({ abi: PAY_ABI, functionName: 'pay' }) }),
            new Frame({ mode: FrameMode.SENDER, target: options.to, gasLimit: 14500000n, stateGasLimit: 40000000n, value: options.value ?? 0n, data: options.data }),
          ] });
        assertSponsoredPqTransaction(tx, this.deployment);
        const signature = signAuthorization(this.key, tx.sigHash());
        const entry: PublicTransactionJournal = { version: 2, chainId: this.deployment.chainId, genesisHash: this.deployment.genesisHash, publicKey: this.publicKey,
          account: this.address, raw: tx.raw(), hash: tx.transactionHash(), authorizationSignature: signature, cacheReady: false, state: 'prepared' };
        this.saveJournal(entry); // No seed or witness: persist the frozen public intent before disclosure.
        return await this.resume(entry, options);
      } catch {
        const entry = this.readJournal();
        return entry ? { kind: 'unknown', hash: entry.hash, reason: 'The signed intent is preserved. Reconcile it before sending another transaction.' } : { kind: 'not-sent', reason: 'PQ transaction preparation did not complete. Nothing was broadcast.' };
      }
    });
  }
  async reconcile(options: Pick<PqSendOptions, 'onProgress' | 'signal' | 'timeoutMs'> & { expectedHash?: Hex } = {}): Promise<PqSendResult> {
    const expectedHash = options.expectedHash ?? this.readJournal()?.hash;
    return this.withLock(`qraft:pq-sign:${this.deployment.chainId}:${this.address.toLowerCase()}`, async () => {
      const entry = this.readJournal();
      if (entry?.hash !== expectedHash) failure('The saved native intent changed while waiting for its lock. Reconcile it in its original workflow.');
      if (!entry) return { kind: 'not-sent', reason: 'There is no saved public transaction to reconcile.' };
      try { return await this.resume(entry, options); }
      catch { entry.state = 'unknown'; this.saveJournal(entry); return { kind: 'unknown', hash: entry.hash, reason: 'The saved native transaction remains unresolved. Its nonce and bytes have not been replaced.' }; }
    });
  }
  private async receipt(entry: PublicTransactionJournal): Promise<PqSendResult | null> {
    const result = await this.transport.request<PqRawReceipt | null>('eth_getTransactionReceipt', [entry.hash]); if (!result) return null;
    if (!isHex(result.transactionHash, 32) || !equal(result.transactionHash, entry.hash) || !isHex(result.from, 20) || !equal(result.from, this.address) || !result.payer || !equal(result.payer, transactionSponsor(decodeFrameTransaction(entry.raw), this.deployment)) || !isHex(result.blockHash, 32) || !quantityHex(result.blockNumber)) failure('The native receipt does not match the saved account and paymaster.');
    const block = await this.transport.request<{ hash: Hex }>('eth_getBlockByNumber', [result.blockNumber, false]);
    if (!block || !equal(block.hash, result.blockHash)) failure('The native receipt is not on the current canonical chain.');
    if (!quantityHex(result.type) || BigInt(result.type) !== 6n || !quantityHex(result.status) || !Array.isArray(result.frameReceipts) || result.frameReceipts.length !== PQ_FRAME_COUNT || result.frameReceipts.some(frame => !quantityHex(frame.status))) failure('The native receipt is missing complete frame evidence.');
    let success = true; try { assertSuccessfulReceipt(result, PQ_FRAME_COUNT); } catch { success = false; }
    this.storage.removeItem(this.journalKey);
    return success ? { kind: 'confirmed', hash: entry.hash, receipt: result } : { kind: 'failed', hash: entry.hash, receipt: result, reason: 'The included native transaction has a failed or skipped frame. Check the note state before choosing another action.' };
  }
  private async resume(entry: PublicTransactionJournal, options: Pick<PqSendOptions, 'onProgress' | 'signal' | 'timeoutMs'>): Promise<PqSendResult> {
    options.signal?.throwIfAborted(); await this.verifyContext(transactionSponsor(decodeFrameTransaction(entry.raw), this.deployment));
    const existing = await this.receipt(entry); if (existing) return existing;
    const tx = decodeFrameTransaction(entry.raw);
    if (await this.nonce() !== tx.nonceSeq) failure('The saved native nonce changed without the expected receipt.');
    if (!entry.cacheReady) {
      options.onProgress?.('Verifying the ML-DSA authorization onchain');
      const answer = await postPublic(this.fetcher, '/api/pq/cache', { publicKey: this.publicKey, address: this.address, raw: entry.raw, signature: entry.authorizationSignature }, options.signal);
      if (!answer || typeof answer !== 'object' || !('hash' in answer) || answer.hash !== entry.hash) failure('The PQ cache helper returned another transaction hash.');
      entry.cacheReady = true; this.saveJournal(entry);
    }
    options.signal?.throwIfAborted();
    if (await this.nonce() !== tx.nonceSeq) failure('The keyed nonce changed while the authorization was prepared.');
    options.onProgress?.('Simulating all native frames');
    const simulated = await this.transport.request<FrameSimulation>('ethrex_simulateFrameTransaction', [entry.raw, 'latest']);
    assertSuccessfulSimulation(simulated, PQ_FRAME_COUNT);
    if (!simulated.payer || !equal(simulated.payer, transactionSponsor(tx, this.deployment))) failure('The native simulation selected another gas payer.');
    options.signal?.throwIfAborted();
    entry.state = 'broadcasting'; this.saveJournal(entry);
    options.onProgress?.('Submitting the exact ML-DSA-authorized native transaction');
    try {
      const hash = await this.transport.request<Hex>('eth_sendRawTransaction', [entry.raw]);
      if (hash !== entry.hash) failure('Unexpected native transaction hash.');
      entry.state = 'submitted'; this.saveJournal(entry);
    } catch { entry.state = 'unknown'; this.saveJournal(entry); }
    const deadline = Date.now() + (options.timeoutMs ?? 180_000);
    while (Date.now() < deadline && !options.signal?.aborted) {
      const result = await this.receipt(entry); if (result) return result;
      options.onProgress?.('Waiting for the native transaction’s canonical receipt');
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
    entry.state = 'unknown'; this.saveJournal(entry);
    return { kind: 'unknown', hash: entry.hash, reason: 'Confirmation is unresolved. Keep the saved intent and reconcile the same hash; do not resend with a new nonce.' };
  }
}
