'use client';

import { IS_DEMO } from '@/config/pool';
import { createAnonRpcTransport } from '@/lib/transport/anon-rpc';
import type { ChainTransport } from '@/lib/transport/types';
import { demoBackend } from './demo';
import type { Backend } from './types';

let cached: { backend: Backend; transport: ChainTransport } | null = null;

/**
 * Single resolution point for the backend. Replacing the simulated backend
 * with a real one is a change here plus one `chainBackend` module — nothing in
 * the interface references `demoBackend` directly.
 */
export function getBackend(): { backend: Backend; transport: ChainTransport } {
  if (cached) return cached;
  const transport = createAnonRpcTransport();
  if (!IS_DEMO) {
    // A chain backend belongs here. Until one exists, failing loudly is better
    // than silently serving simulated data under a real label.
    throw new Error('No chain backend is wired. Set DEPLOYMENT.backend to "demo".');
  }
  cached = { backend: demoBackend(transport), transport };
  return cached;
}

export type { Backend };
