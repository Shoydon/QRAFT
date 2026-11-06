/** Independently reconcile a completed public V5 job and its native-frame receipts. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bytesToHex, createPublicClient, http, keccak256, parseEventLogs, type Abi, type Hex } from 'viem';
import { assertSuccessfulReceipt, decodeFrameTransaction, type FrameReceipt } from '../packages/frame-account/src/frametx';
import manifest from '../public/pq-deployment.json';
import abis from '../public/pq-v5/abis.json';

const id = process.argv[2];
if (!id || !/^[a-f0-9]{64}$/.test(id)) throw Error('Usage: bun scripts/check-pq-live.ts PUBLIC_JOB_ID');
const jobDirectory = `.local/pq-service/proofs/${id}`;
const job = JSON.parse(await readFile(`${jobDirectory}/job.json`, 'utf8'));
assert.equal(job.phase, 'verified');
assert.equal(job.done, 663);
const browser = JSON.parse(await readFile('.local/pq-app-evidence.json', 'utf8'));
assert.equal(browser.chainId, 1337);
assert.equal(browser.resumedPublicJob, id);
assert.equal(browser.sessionId, job.sessionId);
assert.equal(browser.recipientDeltaWei, manifest.denominationWei);
assert.equal(browser.directBrowserRpcPosts, 0);
assert.equal(browser.sensitiveHttpRequests, 0);
const rpc = createPublicClient({ transport: http(manifest.rpcUrl, { timeout: 60000, retryCount: 2 }) });
assert.equal(await rpc.getChainId(), 1337);
assert.equal((await rpc.getBlock({ blockNumber: 0n })).hash, manifest.genesisHash);
const progress = await rpc.readContract({ address: manifest.contracts.session.address as Hex, abi: abis.session as Abi, functionName: 'progress', args: [job.sessionId] }) as readonly bigint[];
assert.equal(progress.map(String).join(','), '10,16,93,21,320,6080,12,0');
const digest = (bytes: number[]) => [bytesToHex(Uint8Array.from(bytes.slice(0, 32))), bytesToHex(Uint8Array.from(bytes.slice(32)))] as const;
assert.equal(await rpc.readContract({ address: manifest.pool as Hex, abi: abis.pool as Abi, functionName: 'isSpent', args: [digest(job.statement.nullifier)] }), true);
const contracts = [];
for (const [name, contract] of Object.entries(manifest.contracts)) {
  const runtimeHash = keccak256(await rpc.getCode({ address: contract.address as Hex }) ?? '0x');
  assert.equal(runtimeHash, contract.runtimeHash, `Runtime mismatch: ${name}`);
  contracts.push({ name, address: contract.address, runtimeHash });
}
type BatchRecord = { start: number; count: number; hash: Hex };
const batchRecords: BatchRecord[] = [];
for (let done = 0; done < 663;) {
  const label: string = `${id}:session:${job.sessionId}:batch:${done}`;
  const key: Hex = keccak256(bytesToHex(new TextEncoder().encode(label)));
  const record: { raw: Hex; hash: Hex; count: number } = JSON.parse(await readFile(`.local/pq-service-1337/${key.slice(2)}.batch.json`, 'utf8'));
  const tx = decodeFrameTransaction(record.raw);
  assert.equal(tx.transactionHash(), record.hash);
  assert.equal(tx.chainId, 1337n);
  assert.equal(tx.nonceKeys[0], BigInt(key));
  assert(Number.isInteger(record.count) && record.count >= 1 && record.count <= 4 && done + record.count <= 663);
  assert.equal(tx.frames.length, record.count + 1);
  for (const frame of tx.frames.slice(1)) {
    assert.equal(frame.target?.toLowerCase(), manifest.contracts.session.address.toLowerCase());
    assert.equal(`0x${frame.data.slice(10, 74)}`, job.sessionId);
  }
  batchRecords.push({ start: done, count: record.count, hash: record.hash as Hex });
  done += record.count;
}
type Receipt = FrameReceipt & { transactionHash: Hex; blockNumber: Hex; gasUsed: Hex; effectiveGasPrice: Hex };
const receipts: unknown[] = [];
let gas = 0n, execution = 0n, state = 0n;
for (let index = 0; index < batchRecords.length; index += 4) {
  const group: BatchRecord[] = batchRecords.slice(index, index + 4);
  const fetched: Receipt[] = await Promise.all(group.map(row => rpc.request({ method: 'eth_getTransactionReceipt', params: [row.hash] }) as unknown as Promise<Receipt>));
  for (const [offset, receipt] of fetched.entries()) {
    const row = group[offset]!;
    assert.equal(receipt.transactionHash.toLowerCase(), row.hash.toLowerCase());
    assertSuccessfulReceipt(receipt, row.count + 1);
    gas += BigInt(receipt.gasUsed);
    for (const frame of receipt.frameReceipts!) {
      execution += BigInt(frame.gasUsed);
      state += BigInt(frame.stateGasUsed ?? '0x0');
    }
    receipts.push({ ...row, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, frameReceipts: receipt.frameReceipts });
  }
}
const withdrawal = await rpc.request({ method: 'eth_getTransactionReceipt', params: [browser.withdrawalHash] });
assert(withdrawal);
assertSuccessfulReceipt(withdrawal as unknown as FrameReceipt, 3);
const events = parseEventLogs({ abi: abis.pool as Abi, logs: withdrawal.logs, eventName: 'Withdrawal', strict: true });
assert.equal(events.length, 1);
const args = events[0]!.args as { nullifierHi: Hex; nullifierLo: Hex; recipient: Hex; sessionId: Hex };
assert.deepEqual([args.nullifierHi, args.nullifierLo], digest(job.statement.nullifier));
assert.equal(args.recipient.toLowerCase(), job.statement.publicContext.recipientHex.toLowerCase());
assert.equal(args.sessionId, job.sessionId);
const envelope = await readFile(`${jobDirectory}/envelope.postcard`);
const sidecarEvidence = [];
for (const hash of [batchRecords.at(-1)!.hash, browser.withdrawalHash as Hex]) {
  const response = await fetch(manifest.sidecarUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skandha_explorer_getTransaction', params: [hash] }), signal: AbortSignal.timeout(60000) });
  const body = await response.json();
  assert(!body.error && body.result, 'Missing sidecar admission evidence');
  assert.equal(body.result.hash.toLowerCase(), hash.toLowerCase());
  sidecarEvidence.push(body.result);
}
const evidence = { checkedAt: new Date().toISOString(), chainId: 1337, genesisHash: manifest.genesisHash, profile: manifest.profile,
  jobId: id, sessionId: job.sessionId, progress: progress.map(String), proofBytes: envelope.length,
  proofSha256: createHash('sha256').update(envelope).digest('hex'), contracts,
  verifierCalls: 663, verificationTransactions: batchRecords.length, verificationGas: String(gas), frameExecutionGas: String(execution), frameStateGas: String(state),
  gasScope: 'Verification batches only; excludes setup, public proof uploads and final withdrawal. Combined receipt gas is separate from summed per-frame gas.',
  browser, withdrawalReceipt: withdrawal, verificationReceipts: receipts, sidecarEvidence };
await writeFile('docs/pq/pq-v5-1337-live.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ verifiedAndConsumed: true, verifierCalls: 663, transactions: batchRecords.length, verificationGas: String(gas), withdrawalHash: browser.withdrawalHash }));
