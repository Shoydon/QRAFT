import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { groth16 } from 'snarkjs';
import { poseidon1, poseidon2 } from 'poseidon-lite';
import { bytesToHex, encodeAbiParameters, keccak256, parseAbi, stringToHex } from 'viem';
import { mnemonicToAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { NoteTree } from '../src/lib/protocol/tree.ts';
import { deploy } from './deploy.mjs';

const port = Number(process.env.QRAFT_TEST_PORT ?? 18547);
const rpcUrl = `http://127.0.0.1:${port}`;
// Public Anvil-only fixture. Never use this account outside the isolated test node.
const account = mnemonicToAccount('test test test test test test test test test test test junk');
const node = spawn('anvil', ['--silent', '--port', String(port), '--chain-id', '31337', '--gas-limit', '100000000'], { stdio: ['ignore', 'pipe', 'pipe'] });
let startupError;
node.on('error', error => { startupError = error; });
const abi = parseAbi([
  'function deposit(bytes32 commitment) payable',
  'function withdraw(bytes32 root,bytes32 nullifierHash,address recipient,uint256[8] proof)',
  'function currentRoot() view returns (bytes32)',
  'function spent(bytes32) view returns (bool)',
]);
const hex32 = n => `0x${n.toString(16).padStart(64, '0')}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError) throw startupError;
    if (node.exitCode !== null) throw Error('Isolated Anvil process exited; check the test port.');
    try { const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_chainId', params:[] }) }); if ((await response.json()).result === '0x7a69') { ready = true; break; } } catch { /* waiting for the child node */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw Error('Isolated local EVM did not start. Install Foundry/anvil.');
  const { manifest, client, wallet } = await deploy({ rpcUrl, privateKey: bytesToHex(account.getHdKey().privateKey), chainName: 'QRAFT local EVM' });
  const verificationKey = JSON.parse(await readFile('public/proving/verification_key.json'));
  const pool = manifest.pools[0];
  const amount = BigInt(pool.denominationWei);
  const tree = new NoteTree();
  const notes = [0,1].map(() => {
    const nullifier = BigInt(generatePrivateKey()) % (2n ** 240n);
    const secret = BigInt(generatePrivateKey()) % (2n ** 240n);
    return { nullifier, secret, commitment: hex32(poseidon2([nullifier, secret])), nullifierHash: hex32(poseidon1([nullifier])) };
  });
  const receipt = async hash => { const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; };
  for (const note of notes) {
    await receipt(await wallet.writeContract({ address: pool.address, abi, functionName: 'deposit', args: [note.commitment], value: amount }));
    tree.insert(BigInt(note.commitment));
  }
  assert.equal(await client.getBalance({ address: pool.address }), amount * 2n);
  assert.equal(await client.readContract({ address: pool.address, abi, functionName: 'currentRoot' }), hex32(tree.root()));
  await assert.rejects(() => client.simulateContract({ account, address: pool.address, abi, functionName: 'deposit', args: [notes[0].commitment], value: amount }));
  await assert.rejects(() => client.simulateContract({ account, address: pool.address, abi, functionName: 'deposit', args: [hex32(5n)], value: amount + 1n }));
  console.log('PASS native ETH deposits, exact denomination, duplicate rejection and circuit-compatible tree');
  async function prove(note, recipient, index) {
    const root = hex32(tree.root());
    const digest = BigInt(keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'bytes32'},{type:'bytes32'},{type:'address'}], [keccak256(stringToHex('QRAFT_NATIVE_ETH_WITHDRAWAL_V1')), BigInt(manifest.chainId), pool.address, amount, root, note.nullifierHash, recipient])));
    const input = { root:String(tree.root()), nullifierHash:String(BigInt(note.nullifierHash)), recipient:String(BigInt(recipient)), txHashHi:String(digest >> 128n), txHashLo:String(digest & (2n**128n-1n)), nullifier:String(note.nullifier), secret:String(note.secret), ...tree.path(index) };
    const { proof, publicSignals } = await groth16.fullProve(input, 'protocol/circuits/spend.wasm', 'protocol/circuits/spend.zkey', undefined, undefined, {singleThread:true});
    assert.equal(await groth16.verify(verificationKey, publicSignals, proof), true);
    const words = (await groth16.exportSolidityCallData(proof, publicSignals)).match(/0x[0-9a-fA-F]+/g).slice(0,8).map(BigInt);
    return { root, words };
  }
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const before = await client.getBalance({ address: recipient });
  const p = await prove(notes[0], recipient, 0);
  const args = [p.root, notes[0].nullifierHash, recipient, p.words];
  await assert.rejects(() => client.simulateContract({ account, address: pool.address, abi, functionName:'withdraw', args: [p.root, notes[0].nullifierHash, account.address, p.words] }));
  const poolArtifact = JSON.parse(await readFile('protocol/build/NativePool.json'));
  const mirrorReceipt = await receipt(await wallet.deployContract({ abi:poolArtifact.abi, bytecode:poolArtifact.bytecode, args:[manifest.transactions[0].address,manifest.transactions[1].address,amount] }));
  for (const note of notes) await receipt(await wallet.writeContract({ address:mirrorReceipt.contractAddress, abi, functionName:'deposit', args:[note.commitment], value:amount }));
  assert.equal(await client.readContract({address:mirrorReceipt.contractAddress,abi,functionName:'currentRoot'}),p.root);
  await assert.rejects(() => client.simulateContract({ account, address: mirrorReceipt.contractAddress, abi, functionName:'withdraw', args }));
  await assert.rejects(() => client.simulateContract({ account, address: pool.address, abi, functionName:'withdraw', args: [p.root, notes[0].nullifierHash, recipient, Array(8).fill(0n)] }));
  const withdrawal = await receipt(await wallet.writeContract({ address: pool.address, abi, functionName:'withdraw', args }));
  assert.equal((await client.getBalance({ address: recipient })) - before, amount);
  assert.equal(await client.getBalance({ address: pool.address }), amount);
  assert.equal(await client.readContract({ address:pool.address, abi, functionName:'spent', args:[notes[0].nullifierHash] }), true);
  await assert.rejects(() => client.simulateContract({ account, address:pool.address, abi, functionName:'withdraw', args }));
  console.log('PASS real Groth16 proof, exact native ETH payout, recipient binding, invalid proof, pool isolation and replay rejection');
  // Rejecting recipient: an actual reverted transaction must leave the note unspent.
  const rejecting = await receipt(await wallet.deployContract({ abi:[], bytecode:'0x6005600c60003960056000f360006000fd' }));
  const bad = await prove(notes[1], rejecting.contractAddress, 1);
  const failed = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address:pool.address, abi, functionName:'withdraw', args:[bad.root,notes[1].nullifierHash,rejecting.contractAddress,bad.words], gas:800000n }) });
  assert.equal(failed.status, 'reverted');
  assert.equal(await client.readContract({ address:pool.address, abi, functionName:'spent', args:[notes[1].nullifierHash] }), false);
  assert.equal(await client.getBalance({ address:pool.address }), amount);
  console.log('PASS reverted native ETH payout rolls back nullifier and pool balance');
  await mkdir('.local', {recursive:true});
  await writeFile('.local/protocol-test.json', JSON.stringify({ chainId:manifest.chainId, tests:'passed', withdrawalHash:withdrawal.transactionHash, recipientDeltaWei:String(amount), payoutRollback:true }, null,2));
} finally { node.kill('SIGTERM'); await globalThis.curve_bn128?.terminate(); }
