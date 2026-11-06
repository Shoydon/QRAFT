/** Local policy tests only; native frame opcodes are exercised separately on the devnet. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, concat, encodePacked, encodeFunctionData, parseAbi } from 'viem';

const node = spawn('anvil', ['--host', '127.0.0.1', '--port', '18545', '--chain-id', '8141', '--silent'], { stdio: 'ignore' });
const transport = http('http://127.0.0.1:18545', { retryCount: 0 });
const client = createPublicClient({ transport });
try {
  for (let i = 0; ; i++) { try { await client.getChainId(); break; } catch { if (i === 50) throw Error('Local policy node did not start.'); await new Promise(r => setTimeout(r, 100)); } }
  const [owner, stranger] = await client.request({ method: 'eth_accounts' });
  const wallet = createWalletClient({ account: owner, transport });
  async function receipt(hash) { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; }
  async function rawContract(runtime) {
    const length = ((runtime.length - 2) / 2).toString(16).padStart(4, '0');
    const data = `0x61${length}61000f60003961${length}6000f3${runtime.slice(2)}`;
    return (await receipt(await wallet.sendTransaction({ chain: null, data }))).contractAddress;
  }
  const implementation = await rawContract('0x00'), validator = await rawContract('0x00');
  const pool = await rawContract('0x00'), verifier = await rawContract('0x00'), blobs = await rawContract('0x00');
  const artifact = JSON.parse(await readFile('packages/frame-account/artifacts/QraftPaymaster.json'));
  const paymaster = (await receipt(await wallet.deployContract({ chain: null, abi: artifact.abi, bytecode: artifact.bytecode, args: [owner, implementation, validator, pool, verifier, blobs] }))).contractAddress;
  const call = (functionName, args) => client.readContract({ address: paymaster, abi: artifact.abi, functionName, args });
  async function clone(scopes = 2, impl = implementation) {
    return rawContract(concat(['0x363d3d373d3d3d363d73', impl, '0x5af43d82803e903d91602b57fd5bf3', encodePacked(['address','uint8','uint8','uint8','address','bytes32'], [validator, scopes, 15, 0, owner, '0x'+'11'.repeat(32)])]));
  }
  assert.equal(await call('supportsAccount', [await clone()]), true);
  assert.equal(await call('supportsAccount', [await clone(3)]), false);
  assert.equal(await call('supportsAccount', [await clone(2, stranger)]), false);
  assert.equal(await call('supportsAccount', [stranger]), false);
  const deposit = encodeFunctionData({ abi: parseAbi(['function deposit(bytes32[2])']), functionName: 'deposit', args: [['0x'+'11'.repeat(32), '0x'+'22'.repeat(32)]] });
  assert.equal(await call('allowedAction', [pool, 100000000000000n, deposit]), true);
  assert.equal(await call('allowedAction', [pool, 0n, deposit]), false);
  assert.equal(await call('allowedAction', [pool, 100000000000001n, deposit]), false);
  assert.equal(await call('allowedAction', [stranger, 0n, '0xdeadbeef']), false);
  assert.equal(await call('allowedAction', [stranger, 100000000000000n, '0x']), true);
  assert.equal(await call('allowedAction', [stranger, 100000000000001n, '0x']), false);
  await receipt(await wallet.sendTransaction({ chain: null, to: paymaster, value: 1000000000000000n }));
  await assert.rejects(client.simulateContract({ account: stranger, address: paymaster, abi: artifact.abi, functionName: 'withdraw', args: [stranger, 1n] }));
  assert.equal(await client.getBalance({ address: paymaster }), 1000000000000000n);
  await receipt(await wallet.writeContract({ chain: null, address: paymaster, abi: artifact.abi, functionName: 'withdraw', args: [owner, 1000000000000000n] }));
  assert.equal(await client.getBalance({ address: paymaster }), 0n);
  console.log('PASS 13 paymaster clone, action, principal-bound, funding and owner-withdrawal policy checks.');
} finally { node.kill('SIGTERM'); }
