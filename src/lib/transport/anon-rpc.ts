'use client';

import { TRANSPORT } from '@/config/transport';
import type { ChainTransport, TransportStatus } from './types';
import type { WorkerInit } from '@anon-rpc/browser-harness';

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
const BOOT_TIMEOUT_MS = 240_000;

const GATEWAY_DETAIL =
  `${TRANSPORT.worker.label} reaches its network through KPS relays, because browsers cannot open ` +
  `raw TCP. Set NEXT_PUBLIC_ANON_RPC_GATEWAYS to at least one gateway and reload. Chain reads stay ` +
  `off until then — this app does not fall back to a direct connection.`;

const missingUrlDetail = (missing: string[]) =>
  `Anonymous reads are not configured. Set ${missing.join(' and ')} in .env.local, then reload. ` +
  `Chain reads stay off until then — this app does not fall back to a direct connection.`;

type WorkerFactory = (init: WorkerInit) => AnonWorker;
interface TransportOptions {
  loadWorker?: () => Promise<WorkerFactory>;
  bootTimeoutMs?: number;
}
async function loadWorker(): Promise<WorkerFactory> {
  const { AnonRpcWorker } = await import('@anon-rpc/browser-harness');
  return init => new AnonRpcWorker(init) as unknown as AnonWorker;
}

export function createAnonRpcTransport(options: TransportOptions = {}): ChainTransport {
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
  let generation = 0;
  let requestId = 0;
  let bootController: AbortController | null = null;

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
        const id = ++requestId;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? [] }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Bootstrap RPC returned HTTP ${res.status}`);
        const json = (await res.json()) as { jsonrpc?: string; id?: number; result?: unknown; error?: { message?: string } };
        if (json.jsonrpc !== '2.0' || json.id !== id) throw new Error('Invalid bootstrap RPC response');
        if (json.error) throw new Error(json.error.message ?? 'Bootstrap RPC error');
        return json.result;
      },
    };
  }

  async function boot(epoch: number): Promise<AnonWorker> {
    const issue = blockingConfigIssue();
    if (issue) {
      set({ phase: 'not-configured', detail: issue });
      throw new Error('transport-not-configured');
    }

    set({ phase: 'starting', detail: null, code: null });

    const controller = new AbortController();
    bootController = controller;
    let instance: AnonWorker | null = null;
    const timeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(new BootTimeout(timeoutMs)), timeoutMs);
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => {
        reject(controller.signal.reason);
        try { instance?.close(); } catch { /* already closed */ }
      };
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });

    try {
      // A cancelled import must never construct a second mixnet client. This
      // matters for React Strict Mode and for reconnecting during startup.
      const createWorker = await Promise.race([(options.loadWorker ?? loadWorker)(), aborted]);
      if (epoch !== generation) throw new DOMException('Transport closed', 'AbortError');
      instance = createWorker({
        address: TRANSPORT.worker.specifier,
        // Bound each Nym tunnel attempt so one unreachable gateway does not
        // consume the entire startup window. Cover traffic stays enabled.
        config: TRANSPORT.worker.label === 'Nym'
          ? { connectTimeoutMs: 20_000, iprAttemptTimeoutMs: 15_000, iprMaxAttempts: 3 }
          : TRANSPORT.gateways.length ? { gateways: TRANSPORT.gateways } : undefined,
        preExisting: { rpcProvider: bootstrapProvider(TRANSPORT.bootstrapRpcUrl as string) },
      });
      await Promise.race([instance.ready, aborted]);
      if (epoch !== generation) throw new DOMException('Transport closed', 'AbortError');
      set({ phase: 'ready', detail: null, code: null });
      return instance;
    } catch (error) {
      if (controller.signal.aborted) error = controller.signal.reason;
      if (!controller.signal.aborted) {
        try { instance?.close(); } catch { /* already closed */ }
      }
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      if (epoch === generation) set({ phase: 'failed', code: code || null, detail: describeBootFailure(code, error) });
      throw error;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', rejectAbort);
      if (bootController === controller) bootController = null;
    }
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
      const epoch = generation;
      booting = boot(epoch).then(
        (w) => {
          if (epoch !== generation) {
            w.close();
            throw new DOMException('Transport closed', 'AbortError');
          }
          worker = w;
          return w;
        },
        (e) => {
          if (epoch === generation) booting = null;
          throw e;
        },
      );
      booting.catch(() => {
        /* status already carries the failure */
      });
    },

    stop() {
      generation += 1;
      bootController?.abort(new DOMException('Transport closed', 'AbortError'));
      worker?.close();
      worker = null;
      booting = null;
      set({ phase: 'idle', detail: null, code: null });
    },

    async request<T>(method: string, params: unknown[] = []): Promise<T> {
      if (!booting) this.start();
      if (!booting) throw new Error(status.detail ?? 'Anonymous reads are unavailable.');

      const epoch = generation;
      const w = await booting;
      if (epoch !== generation) throw new DOMException('Transport closed', 'AbortError');
      const id = ++requestId;
      const started = performance.now();
      const submission = method === 'eth_sendFrameTransaction' || method.startsWith('skandha_') || method === 'eth_getFrameTransactionReceipt';
      const res = await w.fetch(submission ? TRANSPORT.submissionRpcUrl : TRANSPORT.readRpcUrl as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        // A read is idempotent and its caller retries, so a dead mixnet circuit should be
        // abandoned quickly. A submission is not idempotent and keeps the long window.
        signal: AbortSignal.timeout(submission ? 120_000 : 45_000),
      });
      if (epoch !== generation) throw new DOMException('Transport closed', 'AbortError');
      if (!res.ok) throw new Error(`Read failed: the RPC endpoint returned HTTP ${res.status}.`);
      const json = (await res.json()) as { jsonrpc?: string; id?: number; result?: T; error?: { message?: string } };
      if (epoch !== generation) throw new DOMException('Transport closed', 'AbortError');
      if (json.jsonrpc !== '2.0' || json.id !== id || (!Object.hasOwn(json, 'result') && !json.error)) throw new Error('Invalid anonymous RPC response');
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
  constructor(readonly timeoutMs: number) {
    super('boot-timeout');
  }
}

function describeBootFailure(code: string, error: unknown): string {
  if (error instanceof BootTimeout) {
    const recovery = TRANSPORT.worker.needsGateways
      ? 'Check the configured Tor KPS gateways, then reconnect.'
      : 'Reconnect the anonymous network and retry. Nym does not use the Tor KPS gateway setting.';
    return `The ${TRANSPORT.worker.label} network did not become ready within ${Math.round(error.timeoutMs / 1000)} seconds. ${recovery} Chain reads remain off; there is no direct fallback.`;
  }

  if (code === 'unsupported-chain')
    return 'The anonymizing network does not support this chain. Chain reads stay off.';
  if (code)
    return `The anonymizing network declined to start (${code}). Chain reads stay off — this app does not fall back to a direct connection.`;
  const message = error instanceof Error ? error.message : 'unknown error';
  return `The anonymizing network could not start (${message}). Chain reads stay off — this app does not fall back to a direct connection.`;
}
