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
  console.log(`Verified chain ${m.chainId}, genesis/anchor and ${Object.keys(m.contracts).length} pinned contract runtimes. CLI diagnostic uses direct RPC.`);
} catch (error) { console.error(error.shortMessage ?? error.message); process.exitCode = 1; }
