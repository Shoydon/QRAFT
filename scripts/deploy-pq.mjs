/** Journaled deployment of the QRAFT native-frame account, paymaster and V5 namespace. */
import { readFile, mkdir, open, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createPublicClient, http, encodeDeployData, getContractAddress, keccak256, hexToBytes, bytesToHex, parseTransaction } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

async function main() {
const broadcast = process.argv.includes('--broadcast');
const root = resolve('.local/qraft-deployment');
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
// These unmodified upstream primitives have no application namespace or custody authority.
for (const name of ['f1600', 'mldsaVerifier', 'blobs']) {
  const pin = previous.contracts[name], code = await client.getCode({ address: pin.address });
  if (!code || keccak256(code) !== pin.runtimeHash) throw Error(`Reusable primitive pin changed: ${name}`);
  journal.contracts[name] = { ...pin, reused: true };
}
const address = name => journal.contracts[name].address;
const specs = [
  ['validator', await frameArtifact('QraftMldsaValidator'), () => [address('mldsaVerifier')], () => ({ VERIFIER: address('mldsaVerifier'), VERIFIER_CODE_HASH: journal.contracts.mldsaVerifier.runtimeHash })],
  ['implementation', await frameArtifact('QraftFrameAccount'), () => [address('validator')], () => ({ MLDSA_VALIDATOR: address('validator'), MLDSA_VALIDATOR_CODE_HASH: journal.contracts.validator.runtimeHash })],
  ['factory', await frameArtifact('ERC8286AccountFactory'), () => [], () => ({})],
  ['air', await proofArtifact('AirProgram'), () => [], () => ({})],
  ['arithmetic', await proofArtifact('WithdrawalSessionComponentsV5', 'WithdrawalSessionArithmeticV5'), () => [], () => ({})],
  ['authentication', await proofArtifact('WithdrawalSessionComponentsV5', 'WithdrawalSessionAuthenticationV5'), () => [], () => ({})],
  ['stream', await proofArtifact('WithdrawalSessionComponentsV5', 'WithdrawalSessionStreamV5'), () => [], () => ({})],
  ['session', await proofArtifact('WithdrawalVerifierSessionV5'), () => ['air', 'arithmetic', 'authentication', 'blobs', 'stream'].map(address), () => Object.fromEntries(['air', 'arithmetic', 'authentication', 'blobs', 'stream'].map(name => [name, address(name)]))],
  ['pool', await proofArtifact('PqNativePool'), () => [BigInt(previous.denominationWei), address('session'), journal.contracts.session.runtimeHash], () => ({ denomination: previous.denominationWei, verifier: address('session'), verifierCodeHash: journal.contracts.session.runtimeHash })],
  ['paymaster', await frameArtifact('QraftPaymaster'), () => [account.address, ...['implementation', 'validator', 'pool', 'session', 'blobs'].map(address)], () => ({ owner: account.address, implementation: address('implementation'), implementationHash: journal.contracts.implementation.runtimeHash, validator: address('validator'), validatorHash: journal.contracts.validator.runtimeHash, pool: address('pool'), verifier: address('session'), blobs: address('blobs') })],
];
for (const [name, artifact, args, expected] of specs) {
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: args() });
  if ((data.length - 2) / 2 > 125000) throw Error('Contract initcode exceeds devnet headroom.');
  const result = await transact(name, data);
  if (!result) process.exit(0);
  const pin = await runtimePin(artifact, result.record.predicted); await bindings(artifact, pin.address, expected());
  journal.contracts[name] = { ...pin, transactionHash: result.record.hash, block: result.record.block, initDataHash: keccak256(data) }; await persist();
  console.log(JSON.stringify({ deployed: name, address: pin.address, hash: result.record.hash }));
}
const funding = await transact('paymaster-funding', '0x', address('paymaster'), 1000000000000000n);
if (!funding) process.exit(0);
const balance = await client.getBalance({ address: address('paymaster') });
if (balance < 1000000000000000n) throw Error('Paymaster funding did not arrive.');
const anchor = await client.getBlock();
const manifest = { ...previous, contracts: journal.contracts, pool: address('pool'), deploymentBlock: Number(journal.contracts.pool.block), anchorBlock: Number(anchor.number), anchorHash: anchor.hash, applicationEnabled: true, deploymentStatus: 'verified-qraft-sponsored-deployment', deploymentNote: 'QRAFT namespace contracts and bounded native-frame paymaster deployed and runtime-verified.', sponsorship: { chainId: 8141, paymaster: address('paymaster'), fundingHash: funding.record.hash, initialFundingWei: '1000000000000000', nonceLimit: 1000, accountScopes: 2, frameCount: 3 } };
await save(join(root, 'previous-deployment.json'), previous);
await save('public/pq-deployment.json', manifest);
const abis = await json('public/pq-v5/abis.json');
for (const name of ['pool', 'session', 'paymaster']) abis[name] = specs.find(spec => spec[0] === name)[1].abi;
await save('public/pq-v5/abis.json', abis);
console.log(JSON.stringify({ applicationEnabled: true, pool: manifest.pool, paymaster: address('paymaster'), paymasterBalanceWei: String(balance), contracts: Object.keys(journal.contracts).length }));
}
main().catch(error => { console.error(error.shortMessage ?? error.message?.split('\n')[0] ?? 'Deployment stopped. Reconcile its saved journal.'); process.exitCode = 1; });
