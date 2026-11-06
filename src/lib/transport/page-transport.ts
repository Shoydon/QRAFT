import { createAnonRpcTransport } from './anon-rpc';
import type { ChainTransport } from './types';

interface PageConnection { transport?: ChainTransport }
declare global { interface Window { __qraftPageConnection?: PageConnection } }

export function sharedPageTransport(scope: PageConnection, create: () => ChainTransport = createAnonRpcTransport): ChainTransport {
  scope.transport ??= create();
  return scope.transport;
}

/** A network client belongs to the page, not a component's refresh lifecycle. */
export function browserPageTransport(): ChainTransport | null {
  if (typeof window === 'undefined') return null;
  if (!window.__qraftPageConnection) {
    const scope: PageConnection = {};
    window.__qraftPageConnection = scope;
    window.addEventListener('pagehide', event => { if (!event.persisted) scope.transport?.stop(); });
  }
  return sharedPageTransport(window.__qraftPageConnection);
}
