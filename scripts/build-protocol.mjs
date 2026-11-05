import solc from 'solc';
import { poseidonContract } from 'circomlibjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const sources = {};
for (const name of ['NativePool.sol', 'SpendVerifier.sol']) sources[name] = { content: await readFile(new URL(`../protocol/contracts/${name}`, import.meta.url), 'utf8') };
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
const result = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
for (const error of result.errors ?? []) if (error.severity === 'error') throw Error(error.formattedMessage);
await mkdir(new URL('../protocol/build/', import.meta.url), { recursive: true });
for (const contracts of Object.values(result.contracts)) for (const [name, c] of Object.entries(contracts)) {
  if (c.evm.bytecode.object) await writeFile(new URL(`../protocol/build/${name}.json`, import.meta.url), JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, compiler: solc.version() }, null, 2));
}
await writeFile(new URL('../protocol/build/Poseidon.json', import.meta.url), JSON.stringify({ abi: poseidonContract.generateABI(2), bytecode: poseidonContract.createCode(2) }, null, 2));
console.log('Built native ETH pool, Groth16 verifier and Poseidon hasher.');
