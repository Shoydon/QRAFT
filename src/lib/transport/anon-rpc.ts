'use client';

import { TRANSPORT } from '@/config/pool';
import type { ChainTransport, TransportStatus } from './types';

/**
 * Anon-RPC transport.
 *
 * Boot sequence, and what each step costs in privacy:
 *
 * 1. One un-anonymized read of the specifier contract through the bootstrap
 *    RPC, to learn the pinned `keccak256` of the anon-client bundle. This
 *    reveals that this browser read a specifier contract — not any address or
 *    note. Surfaced in the interface rather than hidden.
 * 2. The harness fetches the bundle from untrusted resolvers and refuses to
 *    execute bytes whose hash does not match.
 * 3. The bundle runs in a Web Worker inside a null-origin sandboxed iframe and
 *    hands back an anonymized `fetch`.
 * 4. Every subsequent read goes through that fetch.
 */

type AnonWorker = {
  ready: Promise<void>;
  fetch: typeof fetch;
  close(): void;
};

/**
 * How long to wait for the anonymizing network before calling it unavailable.
 *
 * A mixnet client is a large bundle and a slow handshake — Nym downloads about
 * 18 MB and then negotiates through the mixnet — so this has to be generous.
 * It exists only to stop the interface sitting on "connecting" forever, which
 * is what Tor does when no gateway will relay: it retries with escalating
 * backoff and `ready` never settles either way.
 */
const BOOT_TIMEOUT_MS = 150_000;

const GATEWAY_DETAIL =
  `${TRANSPORT.worker.label} reaches its network through KPS relays, because browsers cannot open ` +
  `raw TCP. Set NEXT_PUBLIC_ANON_RPC_GATEWAYS to at least one gateway and reload. Chain reads stay ` +
  `off until then — this app does not fall back to a direct connection.`;

const missingUrlDetail = (missing: string[]) =>
  `Anonymous reads are not configured. Set ${missing.join(' and ')} in .env.local, then reload. ` +
  `Chain reads stay off until then — this app does not fall back to a direct connection.`;

export function createAnonRpcTransport(): ChainTransport {
  let status: TransportStatus = {
    phase: 'idle',
    network: TRANSPORT.worker.label,
    detail: null,
    code: null,
    lastLatencyMs: null,
    requestCount: 0,
  };

  const listeners = new Set<(s: TransportStatus) => void>();
  let worker: AnonWorker | null = null;
  let booting: Promise<AnonWorker> | null = null;

  function set(next: Partial<TransportStatus>) {
    status = { ...status, ...next };
    for (const l of listeners) l(status);
  }

  /**
   * Reasons this transport cannot start, checked before boot. Reporting a
   * missing gateway up front beats spending a minute on a boot that cannot
   * succeed and then saying the same thing.
   */
  function blockingConfigIssue(): string | null {
    const missing: string[] = [];
    if (!TRANSPORT.bootstrapRpcUrl) missing.push('NEXT_PUBLIC_BOOTSTRAP_RPC_URL');
    if (!TRANSPORT.readRpcUrl) missing.push('NEXT_PUBLIC_READ_RPC_URL');
    if (missing.length) return missingUrlDetail(missing);
    if (TRANSPORT.worker.needsGateways && !TRANSPORT.gateways.length) return GATEWAY_DETAIL;
    return null;
  }

  /** EIP-1193-shaped provider used for exactly one specifier read. */
  function bootstrapProvider(url: string) {
    return {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
        });
        if (!res.ok) throw new Error(`Bootstrap RPC returned HTTP ${res.status}`);
        const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
        if (json.error) throw new Error(json.error.message ?? 'Bootstrap RPC error');
        return json.result;
      },
    };
  }

  async function boot(): Promise<AnonWorker> {
    const issue = blockingConfigIssue();
    if (issue) {
      set({ phase: 'not-configured', detail: issue });
      throw new Error('transport-not-configured');
    }

    set({ phase: 'starting', detail: null, code: null });

    // Imported lazily: the harness spawns a sandboxed iframe and must not be
    // part of the server bundle or the first paint.
    const { AnonRpcWorker, RpcError } = await import('@anon-rpc/browser-harness');

    const instance = new AnonRpcWorker({
      address: TRANSPORT.worker.specifier,
      // The config schema belongs to the network; the harness never interprets
      // it. tor-js reads `gateways`.
      config: TRANSPORT.gateways.length ? { gateways: TRANSPORT.gateways } : undefined,
      preExisting: { rpcProvider: bootstrapProvider(TRANSPORT.bootstrapRpcUrl as string) },
    }) as unknown as AnonWorker;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BootTimeout()),
        BOOT_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([instance.ready, deadline]);
      clearTimeout(timer);
    } catch (error) {
      clearTimeout(timer);
      const code = error instanceof RpcError ? String(error.code ?? '') : '';
      set({
        phase: 'failed',
        code: code || null,
        detail: describeBootFailure(code, error),
      });
      try {
        instance.close();
      } catch {
        /* already torn down */
      }
      throw error;
    }

    set({ phase: 'ready', detail: null, code: null });
    return instance;
  }

  return {
    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },

    start() {
      if (booting) return;
      booting = boot().then(
        (w) => {
          worker = w;
          return w;
        },
        (e) => {
          booting = null;
          throw e;
        },
      );
      booting.catch(() => {
        /* status already carries the failure */
      });
    },

    stop() {
      worker?.close();
      worker = null;
      booting = null;
      set({ phase: 'idle', detail: null, code: null });
    },

    async request<T>(method: string, params: unknown[] = []): Promise<T> {
      if (!booting) this.start();
      if (!booting) throw new Error(status.detail ?? 'Anonymous reads are unavailable.');

      const w = await booting;
      const started = performance.now();
      const res = await w.fetch(TRANSPORT.readRpcUrl as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`Read failed: the RPC endpoint returned HTTP ${res.status}.`);
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      set({
        lastLatencyMs: Math.round(performance.now() - started),
        requestCount: status.requestCount + 1,
      });
      if (json.error) throw new Error(json.error.message ?? 'The RPC endpoint returned an error.');
      return json.result as T;
    },
  };
}

/** Distinguishes "took too long" from "the worker said no". */
class BootTimeout extends Error {
  constructor() {
    super('boot-timeout');
  }
}

function describeBootFailure(code: string, error: unknown): string {
  if (error instanceof BootTimeout)
    return (
      `The ${TRANSPORT.worker.label} network did not become usable within ` +
      `${Math.round(BOOT_TIMEOUT_MS / 1000)} seconds. Its client started, but no gateway would ` +
      `relay the connection — the gateway in NEXT_PUBLIC_ANON_RPC_GATEWAYS may be down, at ` +
      `capacity, or have rotated its key. Chain reads stay off; this app does not fall back to a ` +
      `direct connection.`
    );

  if (code === 'unsupported-chain')
    return 'The anonymizing network does not support this chain. Chain reads stay off.';
  if (code)
    return `The anonymizing network declined to start (${code}). Chain reads stay off — this app does not fall back to a direct connection.`;
  const message = error instanceof Error ? error.message : 'unknown error';
  return `The anonymizing network could not start (${message}). Chain reads stay off — this app does not fall back to a direct connection.`;
}
