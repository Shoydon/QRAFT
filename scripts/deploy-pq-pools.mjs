import { withCarrierLock } from '../src/lib/pq/carrier-lock.ts';
/** Add fixed ETH pools without replacing the existing pool or account infrastructure.
 * Run with node --experimental-strip-types; dry-run unless --broadcast is supplied. */
import { readFile, mkdir, open, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPublicClient, http, encodeDeployData, encodeFunctionData, parseAbi, getContractAddress, keccak256, hexToBytes, bytesToHex, parseTransaction } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

async function deployFixedPools() {
const broadcast = process.argv.includes('--broadcast');
const root = resolve('.local/qraft-fixed-pools');
await mkdir(root, { recursive: true, mode: 0o700 });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const previous = await json('public/pq-deployment.json');
const keyPath = process.env.QRAFT_DEPLOYER_KEY_FILE ?? '.local/deployer.json';
if ((await stat(keyPath)).mode & 0o077) throw Error('Protect the disposable deployer key with mode 0600.');
const key = await json(keyPath);
if (Number(key.chainId) !== 8141) throw Error('Wrong deployer key network.');
const account = privateKeyToAccount(key.privateKey);
if (key.address && key.address.toLowerCase() !== account.address.toLowerCase()) throw Error('Deployer key identity mismatch.');
const client = createPublicClient({ transport: http(previous.rpcUrl, { timeout: 60000, retryCount: 0 }) });
if (await client.getChainId() !== 8141 || (await client.getBlock({ blockNumber: 0n })).hash !== previous.genesisHash) throw Error('Devnet chain/genesis mismatch.');
const journalPath = join(root, 'deployment.json');
let journal;
try { journal = await json(journalPath); }
catch (error) { if (error.code !== 'ENOENT') throw error; journal = { chainId: 8141, genesisHash: previous.genesisHash, deployer: account.address, initialNonce: await client.getTransactionCount({ address: account.address }), contracts: {}, transactions: [] }; }
if (journal.chainId !== 8141 || journal.genesisHash !== previous.genesisHash || journal.deployer !== account.address) throw Error('Deployment journal identity mismatch.');
async function save(path, value) {
  const file = await open(path + '.tmp', 'w', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(path + '.tmp', path);
  const directory = await open(resolve(path, '..'), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
const persist = () => save(journalPath, journal);
const frameArtifact = name => json(`packages/frame-account/artifacts/${name}.json`);
async function proofArtifact(file, name = file) {
  const a = await json(`packages/pq-hiding-stark/contracts/out/${file}.sol/${name}.json`);
  return { abi: a.abi, bytecode: a.bytecode.object, runtime: a.deployedBytecode.object, immutableReferences: a.deployedBytecode.immutableReferences };
}
async function runtimePin(artifact, address) {
  const actual = await client.getCode({ address });
  if (!actual || actual === '0x') throw Error('Missing deployed runtime.');
  const normalized = hexToBytes(actual), expected = hexToBytes(artifact.runtime);
  if (normalized.length !== expected.length) throw Error('Deployed runtime length mismatch.');
  for (const ranges of Object.values(artifact.immutableReferences ?? {}))
    for (const { start, length } of ranges) normalized.set(expected.subarray(start, start + length), start);
  if (keccak256(normalized) !== keccak256(expected)) throw Error('Deployed runtime template mismatch.');
  return { address, runtimeHash: keccak256(actual) };
}
async function bindings(artifact, address, values) {
  for (const [functionName, expected] of Object.entries(values)) {
    const actual = await client.readContract({ address, abi: artifact.abi, functionName });
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw Error(`Constructor binding mismatch: ${functionName}`);
  }
}
async function transact(name, data, to, value = 0n) {
  const inputHash = keccak256(bytesToHex(new TextEncoder().encode(JSON.stringify([data, to ?? null, String(value)]))));
  let record = journal.transactions.find(tx => tx.name === name);
  if (record && record.inputHash !== inputHash) throw Error(`Deployment plan changed: ${name}`);
  if (!record) {
    const nonce = await client.getTransactionCount({ address: account.address });
    const pending = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    if (nonce !== pending || nonce !== journal.initialNonce + journal.transactions.length) throw Error('Deployer nonce ownership changed; reconcile first.');
    const estimate = await client.estimateGas({ account: account.address, data, ...(to ? { to } : {}), value });
    const gas = estimate * 115n / 100n + 50000n;
    if (!broadcast) { console.log(JSON.stringify({ name, nonce, estimatedGas: String(estimate), valueWei: String(value), broadcast: false })); return null; }
    const block = await client.getBlock(), maxFeePerGas = (block.baseFeePerGas ?? 7n) * 2n + 1n;
    if (maxFeePerGas > 128n || await client.getBalance({ address: account.address }) < value + gas * maxFeePerGas) throw Error('Deployer fee or balance budget exceeded.');
    const raw = await account.signTransaction({ type: 'eip1559', chainId: 8141, nonce, data, ...(to ? { to } : {}), value, gas, maxFeePerGas, maxPriorityFeePerGas: 1n });
    record = { name, nonce, raw, hash: keccak256(raw), inputHash, state: 'prepared', ...(to ? {} : { predicted: getContractAddress({ from: account.address, nonce: BigInt(nonce) }) }) };
    journal.transactions.push(record); await persist();
  }
  const parsed = parseTransaction(record.raw);
  if (keccak256(record.raw) !== record.hash || (parsed.data ?? '0x').toLowerCase() !== data.toLowerCase() || Number(parsed.nonce) !== record.nonce || Number(parsed.chainId) !== 8141 || (parsed.to?.toLowerCase() ?? null) !== (to?.toLowerCase() ?? null) || (parsed.value ?? 0n) !== value) throw Error('Saved signed transaction differs from the deployment plan.');
  let receipt = await client.getTransactionReceipt({ hash: record.hash }).catch(error => { if (error.name === 'TransactionReceiptNotFoundError') return null; throw error; });
  if (!receipt) {
    const known = await client.getTransaction({ hash: record.hash }).catch(error => { if (error.name === 'TransactionNotFoundError') return null; throw error; });
    if (!known) {
      if (!broadcast || await client.getTransactionCount({ address: account.address }) !== record.nonce) throw Error('Unresolved deployment requires reconciliation of its saved hash.');
      const hash = await client.sendRawTransaction({ serializedTransaction: record.raw });
      if (hash !== record.hash) throw Error('Broadcast hash mismatch.');
    }
    receipt = await client.waitForTransactionReceipt({ hash: record.hash, timeout: 180000, pollingInterval: 1000 });
  }
  if (receipt.status !== 'success' || (record.predicted && receipt.contractAddress?.toLowerCase() !== record.predicted.toLowerCase())) throw Error(`Deployment transaction failed: ${name}`);
  Object.assign(record, { state: 'confirmed', block: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed) }); await persist();
  return { record, receipt };
}

for (const [name, pin] of Object.entries(previous.contracts)) {
  const code = await client.getCode({ address: pin.address });
  if (!code || keccak256(code) !== pin.runtimeHash) throw Error(`Active infrastructure changed: ${name}`);
}
const additional = (await json('public/pq-pools.json')).pools;
const entries = [];
for (const amount of ['1000000000000000', '10000000000000000', '100000000000000000']) {
  const poolName = `pool-${amount}`, sponsorName = `paymaster-${amount}`;
  const poolArtifact = await proofArtifact('PqNativePool');
  const poolData = encodeDeployData({ abi: poolArtifact.abi, bytecode: poolArtifact.bytecode,
    args: [BigInt(amount), previous.contracts.session.address, previous.contracts.session.runtimeHash] });
  const poolTx = await transact(poolName, poolData);
  if (!poolTx) return;
  const pool = await runtimePin(poolArtifact, poolTx.record.predicted);
  await bindings(poolArtifact, pool.address, { denomination: amount, verifier: previous.contracts.session.address, verifierCodeHash: previous.contracts.session.runtimeHash });
  journal.contracts[poolName] = { ...pool, transactionHash: poolTx.record.hash, block: poolTx.record.block }; await persist();
  const sponsorArtifact = await frameArtifact('QraftPoolPaymaster');
  const sponsorData = encodeDeployData({ abi: sponsorArtifact.abi, bytecode: sponsorArtifact.bytecode,
    args: [account.address, previous.contracts.implementation.address, previous.contracts.validator.address, pool.address, previous.contracts.session.address, previous.contracts.blobs.address] });
  const sponsorTx = await transact(sponsorName, sponsorData);
  if (!sponsorTx) return;
  const sponsor = await runtimePin(sponsorArtifact, sponsorTx.record.predicted);
  await bindings(sponsorArtifact, sponsor.address, { owner: account.address, pool: pool.address, DENOMINATION: amount,
    implementation: previous.contracts.implementation.address, implementationHash: previous.contracts.implementation.runtimeHash,
    validator: previous.contracts.validator.address, validatorHash: previous.contracts.validator.runtimeHash,
    verifier: previous.contracts.session.address, blobs: previous.contracts.blobs.address });
  journal.contracts[sponsorName] = { ...sponsor, transactionHash: sponsorTx.record.hash, block: sponsorTx.record.block }; await persist();
  const depositData = encodeFunctionData({ abi: parseAbi(['function deposit(bytes32[2] commitment) payable']), functionName: 'deposit', args: [['0x'+'00'.repeat(32), '0x'+'00'.repeat(32)]] });
  const allowed = value => client.readContract({ address: sponsor.address, abi: sponsorArtifact.abi, functionName: 'allowedAction', args: [pool.address, value, depositData] });
  if (await allowed(BigInt(amount)) !== true || await allowed(BigInt(amount)+1n) !== false) throw Error('Sponsor amount policy differs from the pool.');
  const funded = await transact(`fund-${amount}`, '0x', sponsor.address, 1000000000000000n);
  if (!funded) return;
  if (await client.getBalance({ address: sponsor.address }) < 1000000000000000n) throw Error('Sponsor funding is incomplete.');
  const entry = { chainId: previous.chainId, genesisHash: previous.genesisHash, pool: pool.address, denominationWei: amount,
    deploymentBlock: Number(poolTx.record.block), runtimeHash: pool.runtimeHash, paymaster: sponsor.address,
    paymasterRuntimeHash: sponsor.runtimeHash, verifier: previous.contracts.session.address };
  const existing = additional.find(p => p.denominationWei === amount || p.pool.toLowerCase() === pool.address.toLowerCase());
  if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) throw Error('A registered pool conflicts with this deployment.');
  entries.push(entry);
  console.log(JSON.stringify({ denominationWei: amount, pool: pool.address, paymaster: sponsor.address, verified: true }));
}
if (JSON.stringify(await json('public/pq-deployment.json')) !== JSON.stringify(previous)) throw Error('The active deployment changed during pool setup. Registry was not published.');
await save('public/pq-pools.json', { version: 1, pools: [...additional.filter(p => !entries.some(e => e.pool.toLowerCase() === p.pool.toLowerCase())), ...entries] });
console.log('Published three independently verified pool and sponsor pairs; original pool preserved.');
}
withCarrierLock(resolve('.local/pq-service'), deployFixedPools).catch(error => {
  console.error(error.shortMessage ?? error.message?.split('\n')[0] ?? 'Pool deployment stopped; preserve its journal.'); process.exitCode = 1;
});
