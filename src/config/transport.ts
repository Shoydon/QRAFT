import type { Hex } from 'viem';
import pqManifest from '../../public/pq-deployment.json';

/**
 * Anonymizing networks published as hash-pinned anon-rpc workers. Specifier
 * addresses are the networks' own published values, not ours.
 */
export const ANON_WORKERS = {
  nym: {
    label: 'Nym',
    specifier: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0' as Hex,
    specifierChain: 'Ethereum mainnet',
    anonymizing: true,
    needsGateways: false,
  },
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
      : ANON_WORKERS.nym,
  /** Read once, un-anonymized, only to learn the pinned worker hash. */
  bootstrapRpcUrl: process.env.NEXT_PUBLIC_BOOTSTRAP_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
  /** Where anonymized reads are sent. This provider sees the request, not you. */
  readRpcUrl:
    process.env.NEXT_PUBLIC_READ_RPC_URL ?? pqManifest.rpcUrl,
  /** Comma-separated `host:port:key` KPS gateways, for workers that need them. */
  gateways: (process.env.NEXT_PUBLIC_ANON_RPC_GATEWAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;
