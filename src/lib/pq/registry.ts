import type { Hex } from 'viem';
import manifest from '../../../public/pq-deployment.json';
import registry from '../../../public/pq-pools.json';
import { parsePqNote, type PqDeployment } from './note';

export interface RegisteredPqPool extends PqDeployment {
  readonly deploymentBlock: number;
  readonly runtimeHash: Hex;
  readonly paymaster: Hex;
  readonly paymasterRuntimeHash: Hex;
  readonly verifier: Hex;
}
export const DEFAULT_PQ_POOL: RegisteredPqPool = {
  chainId: manifest.chainId, genesisHash: manifest.genesisHash as Hex,
  pool: manifest.pool as Hex, denominationWei: manifest.denominationWei,
  deploymentBlock: manifest.deploymentBlock, runtimeHash: manifest.contracts.pool.runtimeHash as Hex,
  paymaster: manifest.contracts.paymaster.address as Hex,
  paymasterRuntimeHash: manifest.contracts.paymaster.runtimeHash as Hex,
  verifier: manifest.contracts.session.address as Hex,
};
const hex = (value: unknown, bytes: number): value is Hex => typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
export function validatePqPools(base: RegisteredPqPool, additional: readonly unknown[]): readonly RegisteredPqPool[] {
  const pools: RegisteredPqPool[] = [base];
  for (const value of additional) {
    if (!value || typeof value !== 'object') throw Error('Invalid PQ pool registration.');
    const p = value as Record<string, unknown>;
    if (p.chainId !== base.chainId || p.genesisHash !== base.genesisHash || !hex(p.pool, 20) || BigInt(p.pool) === 0n ||
      !hex(p.runtimeHash, 32) || !hex(p.paymaster, 20) || BigInt(p.paymaster) === 0n || !hex(p.paymasterRuntimeHash, 32) ||
      !hex(p.verifier, 20) || p.verifier.toLowerCase() !== base.verifier.toLowerCase() ||
      typeof p.denominationWei !== 'string' || !/^[1-9][0-9]*$/.test(p.denominationWei) || BigInt(p.denominationWei) > 100000000000000000n ||
      !Number.isSafeInteger(p.deploymentBlock) || Number(p.deploymentBlock) < 1) throw Error('PQ pool registration does not match the active deployment.');
    if (pools.some(other => other.pool.toLowerCase() === p.pool!.toString().toLowerCase() || other.denominationWei === p.denominationWei || other.paymaster.toLowerCase() === p.paymaster!.toString().toLowerCase())) throw Error('Duplicate PQ pool, denomination, or sponsor registration.');
    pools.push({ chainId: base.chainId, genesisHash: base.genesisHash, pool: p.pool, denominationWei: p.denominationWei,
      deploymentBlock: Number(p.deploymentBlock), runtimeHash: p.runtimeHash, paymaster: p.paymaster,
      paymasterRuntimeHash: p.paymasterRuntimeHash, verifier: p.verifier });
  }
  return Object.freeze(pools.sort((a, b) => BigInt(a.denominationWei) < BigInt(b.denominationWei) ? -1 : 1));
}
if (registry.version !== 1) throw Error('Unsupported PQ pool registry.');
export const PQ_POOLS = validatePqPools(DEFAULT_PQ_POOL, registry.pools);
export function registeredPqPool(address: string): RegisteredPqPool {
  const pool = PQ_POOLS.find(p => p.pool.toLowerCase() === address.toLowerCase());
  if (!pool) throw Error('This pool is not registered for the active PQ deployment.');
  return pool;
}
export function parseRegisteredPqNote(text: string) {
  for (const pool of PQ_POOLS) {
    try { return { note: parsePqNote(text, pool), pool }; } catch { /* try the next registered deployment */ }
  }
  throw Error('This note does not match a registered pool, amount, or network.');
}
