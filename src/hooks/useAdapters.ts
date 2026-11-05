'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { getBackend } from '@/lib/adapters';
import type { AccountState, Backend } from '@/lib/adapters/types';
import type { ChainTransport, TransportStatus } from '@/lib/transport/types';

const DISCONNECTED: AccountState = {
  status: 'disconnected',
  address: null,
  chainId: null,
  balanceWei: null,
  providerLabel: null,
  error: null,
  simulated: false,
};

/**
 * Resolves the backend after mount only. Keeps the server render and the first
 * client render identical, and keeps wallet detection out of module scope.
 */
export function useBackend(): { backend: Backend | null; transport: ChainTransport | null } {
  // Resolved synchronously on the client and never on the server, so the first
  // client render matches the server HTML without a mount round-trip. Nothing
  // backend-dependent may change the rendered markup on that first pass.
  return useMemo(() => {
    if (typeof window === 'undefined') return { backend: null, transport: null };
    const { backend, transport } = getBackend();
    return { backend, transport };
  }, []);
}

export function useAccountState(backend: Backend | null): AccountState {
  const subscribe = useMemo(
    () => (listener: () => void) =>
      backend ? backend.account.subscribe(() => listener()) : () => {},
    [backend],
  );
  const snapshot = useMemo(
    () => () => backend?.account.getState() ?? DISCONNECTED,
    [backend],
  );
  return useSyncExternalStore(subscribe, snapshot, () => DISCONNECTED);
}

const IDLE_TRANSPORT: TransportStatus = {
  phase: 'idle',
  network: '—',
  detail: null,
  code: null,
  lastLatencyMs: null,
  requestCount: 0,
};

export function useTransportStatus(transport: ChainTransport | null): TransportStatus {
  const subscribe = useMemo(
    () => (listener: () => void) =>
      transport ? transport.subscribe(() => listener()) : () => {},
    [transport],
  );
  const snapshot = useMemo(
    () => () => transport?.getStatus() ?? IDLE_TRANSPORT,
    [transport],
  );
  return useSyncExternalStore(subscribe, snapshot, () => IDLE_TRANSPORT);
}
