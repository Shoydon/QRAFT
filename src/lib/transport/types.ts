/**
 * Chain read transport. Every chain read in the app goes through this
 * interface, so there is exactly one place where anonymity can be lost.
 *
 * Deliberately there is no direct-RPC implementation: a silent fallback from
 * the anonymizing network to a direct connection would leak the link between
 * a browser and the notes it is reading about, which is the link the pool
 * exists to hide. When the anonymous transport cannot start, reads stop.
 */

export type TransportPhase =
  | 'idle'
  | 'not-configured'
  | 'starting'
  | 'ready'
  | 'failed';

export interface TransportStatus {
  readonly phase: TransportPhase;
  /** Human-readable anonymizing network name, e.g. "tor-js". */
  readonly network: string;
  /** Problem and recovery, when phase is 'failed' or 'not-configured'. */
  readonly detail: string | null;
  /** Worker-defined error code, when the worker declined. */
  readonly code: string | null;
  readonly lastLatencyMs: number | null;
  readonly requestCount: number;
}

export interface ChainTransport {
  getStatus(): TransportStatus;
  subscribe(listener: (status: TransportStatus) => void): () => void;
  /** Begins boot. Safe to call repeatedly; only the first call boots. */
  start(): void;
  /** Tears down the sandbox. */
  stop(): void;
  /** JSON-RPC call routed through the anonymizing network. */
  request<T>(method: string, params?: unknown[]): Promise<T>;
}
