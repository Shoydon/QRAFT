import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, createWalletClient, defineChain, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pathToFileURL } from 'node:url';

export async function deploy({ rpcUrl, privateKey, output, chainName = 'QRAFT testnet' }) {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 60000, retryCount: 0 }) });
  const chainId = await client.getChainId();
  if (![31337, 8141, 1337, 3151908].includes(chainId)) throw Error('Deploy only to the supported disposable development chains.');
  const genesisHash = (await client.getBlock({ blockNumber: 0n })).hash;
  if (chainId === 8141 && genesisHash !== '0x2036e3fe3eaaa15382a9befde816137b6b2cda1e3df8ca0c92e89bc17a3fca5a') throw Error('Ethrex genesis changed. Do not deploy against an unreviewed reset.');
  const account = privateKeyToAccount(privateKey);
  const chain = defineChain({ id: chainId, name: chainName, nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 60000, retryCount: 0 }) });
  const hashes = {};
  const transactions = [];
  const artifact = async name => JSON.parse(await readFile(new URL(`../protocol/build/${name}.json`, import.meta.url)));
  async function contract(name, args = []) {
    const a = await artifact(name);
    const nonce = await client.getTransactionCount({ address: account.address });
    if (nonce !== await client.getTransactionCount({ address: account.address, blockTag: 'pending' })) throw Error('Reconcile pending deployment transactions first.');
    const block = await client.getBlock();
    const request = await wallet.prepareTransactionRequest({ maxFeePerGas: (block.baseFeePerGas ?? 7n) * 2n + 1n, maxPriorityFeePerGas: 1n, data: (await import('viem')).encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }), nonce });
    const raw = await wallet.signTransaction(request);
    const hash = keccak256(raw);
    await mkdir('.local/deploy-signed', { recursive: true, mode: 0o700 });
    await writeFile(`.local/deploy-signed/${chainId}-${nonce}-${hash}.json`, JSON.stringify({ chainId, rpcUrl, nonce, hash, raw }), { mode: 0o600 });
    // Save exact signed bytes before sending; never construct a replacement on timeout.
    await client.sendRawTransaction({ serializedTransaction: raw });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw Error(`Deployment failed: ${hash}`);
    const code = await client.getCode({ address: receipt.contractAddress });
    hashes[receipt.contractAddress] = keccak256(code);
    transactions.push({ contract: name, hash, address: receipt.contractAddress, block: Number(receipt.blockNumber) });
    return receipt.contractAddress;
  }
  const hasher = await contract('Poseidon');
  const verifier = await contract('SpendVerifierStock');
  const pools = [];
  for (const [ref, amount] of [['eth-0.01',10n**16n],['eth-0.1',10n**17n],['eth-1',10n**18n],['eth-10',10n**19n]]) {
    const address = await contract('NativePool', [hasher, verifier, amount]);
    pools.push({ ref, address, denominationWei: String(amount) });
  }
  const anchor = await client.getBlock();
  const manifest = { version: 1, id: `qraft:${chainId}:${pools[0].address.toLowerCase()}:${genesisHash}`, chainId, chainName, rpcUrl, genesisHash, deploymentBlock: transactions[0].block, anchorBlock: Number(anchor.number), anchorHash: anchor.hash, explorerBase: null, pools, codeHashes: hashes, artifacts: JSON.parse(await readFile(new URL('../protocol/artifacts.json', import.meta.url))), transactions };
  if (output) await writeFile(output, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, client, wallet };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const keyFile = process.env.QRAFT_DEPLOYER_KEY_FILE;
    if (!keyFile) throw Error('Set QRAFT_DEPLOYER_KEY_FILE to a protected local test-only key JSON.');
    const { stat } = await import('node:fs/promises');
    if ((await stat(keyFile)).mode & 0o077) throw Error('Key file must have mode 0600.');
    const key = JSON.parse(await readFile(keyFile));
    const rpcUrl = process.env.QRAFT_RPC_URL ?? 'http://127.0.0.1:8545';
    const { manifest } = await deploy({ rpcUrl, privateKey: key.privateKey, output: 'public/deployment.json', chainName: process.env.QRAFT_CHAIN_NAME ?? 'Ethrex testnet' });
    console.log(JSON.stringify({ status: 'deployed', chainId: manifest.chainId, pools: manifest.pools.map(p => ({ ref: p.ref, address: p.address })) }, null, 2));
  } catch (error) { console.error(JSON.stringify({message:error.shortMessage ?? error.message, details:error.details, cause:error.cause?.details})); process.exitCode = 1; }
}
