import './check-pq-artifacts.mjs';
import { readFile } from 'node:fs/promises';
import { createPublicClient, http, keccak256, parseAbi } from 'viem';
const m = JSON.parse(await readFile('public/pq-deployment.json'));
if (!m.applicationEnabled) throw Error('The QRAFT protocol requires a fresh deployment. Historical contract pins are not valid for this namespace.');
const c = createPublicClient({ transport: http(process.env.QRAFT_RPC_URL ?? m.rpcUrl, { retryCount: 0, timeout: 20000 }) });
try {
  if (await c.getChainId() !== m.chainId || (await c.getBlock({ blockNumber: 0n })).hash !== m.genesisHash || (await c.getBlock({ blockNumber: BigInt(m.anchorBlock) })).hash !== m.anchorHash) throw Error('Deployment chain identity changed. Do not deposit.');
  for (const { address, runtimeHash } of Object.values(m.contracts)) {
    const code = await c.getCode({ address });
    if (!code || keccak256(code) !== runtimeHash) throw Error(`Deployment code mismatch: ${address}`);
  }
  const abi = parseAbi(['function denomination() view returns(uint256)', 'function nextIndex() view returns(uint256)']);
  if (await c.readContract({ address: m.pool, abi, functionName: 'denomination' }) !== BigInt(m.denominationWei)) throw Error('Pool denomination mismatch');
  console.log(`PQ pool ${m.pool}: ${await c.readContract({ address: m.pool, abi, functionName: 'nextIndex' })} deposits, ${await c.getBalance({ address: m.pool })} wei.`);
  const registry = JSON.parse(await readFile('public/pq-pools.json'));
  if (registry.version !== 1) throw Error('Unsupported pool registry');
  for (const pool of registry.pools) {
    if (pool.chainId !== m.chainId || pool.genesisHash !== m.genesisHash || pool.verifier.toLowerCase() !== m.contracts.session.address.toLowerCase()) throw Error('Registered pool network/verifier mismatch');
    for (const [address, expected] of [[pool.pool, pool.runtimeHash], [pool.paymaster, pool.paymasterRuntimeHash]]) {
      const code = await c.getCode({ address }); if (!code || keccak256(code) !== expected) throw Error('Registered pool or sponsor runtime mismatch');
    }
    const amount = await c.readContract({ address: pool.pool, abi, functionName: 'denomination' });
    const sponsorAbi = parseAbi(['function pool() view returns(address)', 'function DENOMINATION() view returns(uint256)']);
    if (amount !== BigInt(pool.denominationWei) || await c.readContract({ address: pool.paymaster, abi: sponsorAbi, functionName: 'DENOMINATION' }) !== amount ||
      (await c.readContract({ address: pool.paymaster, abi: sponsorAbi, functionName: 'pool' })).toLowerCase() !== pool.pool.toLowerCase()) throw Error('Pool/sponsor denomination binding mismatch');
    console.log(`PQ pool ${pool.pool}: ${amount} wei denomination; sponsor ${pool.paymaster}.`);
  }
  console.log(`Verified chain ${m.chainId}, genesis/anchor, ${Object.keys(m.contracts).length} core runtimes and ${registry.pools.length} additional pool/sponsor pairs. CLI diagnostic uses direct RPC.`);
} catch (error) { console.error(error.shortMessage ?? error.message); process.exitCode = 1; }
