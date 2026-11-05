import type { Hex } from 'viem';

/**
 * Deployment and pool configuration.
 *
 * No pool contract is deployed for this build, so `address` is `null` and the
 * deployment identity is a placeholder rather than an invented address.
 * A real deployment replaces this module (or loads a signed manifest into the
 * same shape) and sets `backend: 'chain'`.
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
  /** `'simulated'` means chain-facing adapters do not touch a contract. */
  readonly backend: 'simulated' | 'chain';
}

const ETH = 10n ** 18n;

export const DEPLOYMENT: DeploymentConfig = {
  id: 'qraft:altmempool-devnet:eth-fixed:1',
  // The EIP-8141 alternative-mempool devnet. Frame transactions exist on no
  // public testnet, so this is the only chain the F in QRAFT can run on.
  //
  // It is explicitly a throwaway network: no persistence guarantee, and it may
  // reset at any time. A reset does not change the chain id, so notes created
  // before one would still validate but point at deposits that no longer
  // exist. Bump `id` after any reset so stale notes are refused outright
  // rather than reading as permanently pending.
  chainId: 1337,
  chainName: 'Alt mempool devnet',
  // The explorer's URL scheme is not documented and its SPA answers 200 for
  // every path, so there is nothing to verify a guess against. Left null until
  // someone opens a real transaction in the browser and reads the address bar;
  // until then the interface shows references without a link rather than
  // linking somewhere that 404s.
  explorerBase: null,
  noteVersion: 1,
  backend: 'simulated',
  pools: [
    { ref: 'eth-0.01', address: null, denominationWei: ETH / 100n, label: '0.01 ETH' },
    { ref: 'eth-0.1', address: null, denominationWei: ETH / 10n, label: '0.1 ETH' },
    { ref: 'eth-1', address: null, denominationWei: ETH, label: '1 ETH' },
    { ref: 'eth-10', address: null, denominationWei: ETH * 10n, label: '10 ETH' },
  ],
};

export const DEFAULT_POOL_REF: PoolRef = 'eth-0.1';

export const IS_SIMULATED = DEPLOYMENT.backend === 'simulated';

export function poolByRef(ref: string): PoolConfig | null {
  return DEPLOYMENT.pools.find((p) => p.ref === ref) ?? null;
}

/**
 * Anonymizing networks published as hash-pinned anon-rpc workers. Specifier
 * addresses are the networks' own published values, not ours.
 */
export const ANON_WORKERS = {
  'tor-js': {
    label: 'tor-js',
    specifier: '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e' as Hex,
    specifierChain: 'Ethereum mainnet',
    anonymizing: true,
    /** Browsers cannot open raw TCP, so Tor is reached through KPS relays. */
    needsGateways: true,
  },
  passthrough: {
    label: 'passthrough',
    specifier: '0x4fd77be300f31c5fe6ab266d35d27750a3478d27' as Hex,
    specifierChain: 'Ethereum mainnet',
    /** Fulfils calls with an ordinary fetch. It anonymizes nothing. */
    anonymizing: false,
    needsGateways: false,
  },
} as const;

export type AnonWorkerId = keyof typeof ANON_WORKERS;

const requestedWorker = process.env.NEXT_PUBLIC_ANON_RPC_WORKER as AnonWorkerId | undefined;

/**
 * Read-transport configuration. The defaults make anonymous reads the
 * out-of-the-box behaviour; setting any variable to an empty string turns the
 * corresponding requirement off and the app reports it as not configured
 * rather than reading directly.
 */
export const TRANSPORT = {
  worker:
    requestedWorker && requestedWorker in ANON_WORKERS
      ? ANON_WORKERS[requestedWorker]
      : ANON_WORKERS['tor-js'],
  /** Read once, un-anonymized, only to learn the pinned worker hash. */
  bootstrapRpcUrl: process.env.NEXT_PUBLIC_BOOTSTRAP_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
  /** Where anonymized reads are sent. This provider sees the request, not you. */
  readRpcUrl: process.env.NEXT_PUBLIC_READ_RPC_URL ?? 'https://altmempool.forshtat.com',
  /** Comma-separated `host:port:key` KPS gateways, for workers that need them. */
  gateways: (process.env.NEXT_PUBLIC_ANON_RPC_GATEWAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
