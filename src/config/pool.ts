import type { Hex } from 'viem';
import manifest from '../../public/deployment.json';
import provingHashes from '../../protocol/artifacts.json';

/**
 * Deployment and pool configuration.
 *
 * Public deployment identity and artifact hashes are pinned in the shipped
 * manifest. A network reset or wrong contract code disables chain operations.
 */

export type PoolRef = 'eth-0.01' | 'eth-0.1' | 'eth-1' | 'eth-10';

export interface PoolConfig {
  /** Stable reference written into the note. Identifies the denomination. */
  readonly ref: PoolRef;
  /** Deployed pool contract, or `null` when no contract exists yet. */
  readonly address: Hex | null;
  /** Denomination in wei. Fixed per pool. */
  readonly denominationWei: bigint;
  readonly label: string;
}

export interface DeploymentConfig {
  /**
   * Deployment identity written into every note. A note that does not carry
   * this exact value belongs to another deployment and is refused.
   */
  readonly id: string;
  readonly chainId: number;
  readonly chainName: string;
  /** Block explorer base, or `null` when the chain has no public explorer. */
  readonly explorerBase: string | null;
  readonly noteVersion: 1;
  readonly pools: readonly PoolConfig[];
  /** `'demo'` means chain-facing adapters are simulated. */
  readonly backend: 'simulated' | 'chain';
}

export const DEPLOYMENT_MANIFEST = manifest;
export const PROVING_HASHES = provingHashes;
const refs: readonly string[] = ['eth-0.01', 'eth-0.1', 'eth-1', 'eth-10'];
if (manifest.version !== 1 || !Number.isSafeInteger(manifest.chainId) || manifest.chainId < 1 ||
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.genesisHash) || manifest.pools.length !== 4 ||
    new Set(manifest.pools.map(pool => pool.ref)).size !== 4 ||
    manifest.pools.some(pool => !refs.includes(pool.ref) || !/^0x[0-9a-fA-F]{40}$/.test(pool.address) || !/^[1-9][0-9]*$/.test(pool.denominationWei)) ||
    Object.entries(PROVING_HASHES).some(([name, hash]) => manifest.artifacts[name as keyof typeof PROVING_HASHES] !== hash)) {
  throw new Error('Invalid QRAFT deployment manifest. Restore the matching deployment and proving artifacts.');
}

export const DEPLOYMENT: DeploymentConfig = {
  id: manifest.id,
  chainId: manifest.chainId,
  chainName: manifest.chainName,
  explorerBase: manifest.explorerBase,
  noteVersion: 1,
  backend: ['demo', 'simulated'].includes(process.env.NEXT_PUBLIC_BACKEND ?? '') ? 'simulated' : 'chain',
  pools: manifest.pools.map(pool => ({
    ref: pool.ref as PoolRef,
    address: pool.address as Hex,
    denominationWei: BigInt(pool.denominationWei),
    label: `${Number(pool.denominationWei) / 1e18} ETH`,
  })),
};

export const DEFAULT_POOL_REF: PoolRef = 'eth-0.1';

export const IS_SIMULATED = DEPLOYMENT.backend === 'simulated';
export const IS_DEMO = IS_SIMULATED;

export function poolByRef(ref: string): PoolConfig | null {
  return DEPLOYMENT.pools.find((p) => p.ref === ref) ?? null;
}

// Historical pool consumers can share the current transport configuration.
export { ANON_WORKERS, TRANSPORT, type AnonWorkerId } from './transport';
