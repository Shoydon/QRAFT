'use client';

import { IS_SIMULATED } from '@/config/pool';
import { createAnonRpcTransport } from '@/lib/transport/anon-rpc';
import type { ChainTransport } from '@/lib/transport/types';
import { simulatedBackend } from './simulated';
import type { Backend } from './types';

let cached: { backend: Backend; transport: ChainTransport } | null = null;

/**
 * Single resolution point for the backend. Replacing the simulated backend
 * with a real one is a change here plus one `chainBackend` module — nothing in
 * the interface references `simulatedBackend` directly.
 */
export function getBackend(): { backend: Backend; transport: ChainTransport } {
  if (cached) return cached;
  const transport = createAnonRpcTransport();
  if (!IS_SIMULATED) {
    // A chain backend belongs here. Until one exists, failing loudly is better
    // than silently serving simulated data under a real label.
    throw new Error('No chain backend is wired. Set DEPLOYMENT.backend to "simulated".');
  }
  cached = { backend: simulatedBackend(transport), transport };
  return cached;
}

export type { Backend };
