import { expect, test } from 'bun:test';
import { createAnonRpcTransport } from '../src/lib/transport/anon-rpc';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function worker(ready: Promise<void> = Promise.resolve()) {
  const calls: string[] = []; let closed = 0;
  return {
    ready,
    get closed() { return closed; },
    close() { closed++; },
    calls,
    fetch: (async (_url, init) => {
      const request = JSON.parse(String(init?.body)); calls.push(request.method);
      return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x1fcd' });
    }) as typeof fetch,
  };
}

test('Strict Mode cleanup cancels a pending module import before constructing its worker', async () => {
  const old = deferred<(init: unknown) => ReturnType<typeof worker>>();
  const fresh = worker(); let loads = 0; let staleConstructions = 0;
  const transport = createAnonRpcTransport({ loadWorker: () => ++loads === 1 ? old.promise : Promise.resolve(() => fresh) });
  transport.start(); transport.stop(); transport.start();
  old.resolve(() => { staleConstructions++; return worker(); });
  expect(await transport.request<string>('eth_chainId')).toBe('0x1fcd');
  expect(staleConstructions).toBe(0); expect(transport.getStatus().phase).toBe('ready');
  transport.stop(); expect(fresh.closed).toBe(1);
});

test('reconnecting closes the starting worker and ignores its late readiness', async () => {
  const pending = deferred<void>(); const old = worker(pending.promise); const fresh = worker(); let loads = 0;
  const transport = createAnonRpcTransport({ loadWorker: async () => () => ++loads === 1 ? old : fresh });
  const first = transport.request<string>('eth_chainId'); const rejected = first.catch(error => error);
  await tick(); transport.stop(); expect(old.closed).toBe(1);
  expect(await transport.request<string>('eth_chainId')).toBe('0x1fcd');
  pending.resolve(); await tick(); expect((await rejected as Error).name).toBe('AbortError');
  expect(transport.getStatus().phase).toBe('ready'); expect(old.calls).toEqual([]);
  transport.stop();
});

test('module-load failure becomes visible and a later attempt can recover', async () => {
  let attempts = 0; const fresh = worker();
  const transport = createAnonRpcTransport({ loadWorker: async () => {
    if (++attempts === 1) throw Error('Worker bundle could not load');
    return () => fresh;
  } });
  await expect(transport.request<string>('eth_chainId')).rejects.toThrow('Worker bundle could not load');
  expect(transport.getStatus().phase).toBe('failed');
  expect(transport.getStatus().detail).toContain('Worker bundle could not load');
  expect(await transport.request<string>('eth_chainId')).toBe('0x1fcd'); transport.stop();
});

test('startup timeout closes the client and does not send a direct chain request', async () => {
  const stuck = worker(new Promise<void>(() => {}));
  const transport = createAnonRpcTransport({ loadWorker: async () => () => stuck, bootTimeoutMs: 15 });
  await expect(transport.request<string>('eth_chainId')).rejects.toThrow('boot-timeout');
  expect(stuck.closed).toBe(1); expect(stuck.calls).toEqual([]);
  expect(transport.getStatus().phase).toBe('failed');
  expect(transport.getStatus().detail).toContain('Nym does not use the Tor KPS gateway setting'); transport.stop();
});

test('a response from the old connection cannot update the reconnected transport', async () => {
  const response = deferred<Response>(); const old = worker(); old.fetch = (() => response.promise) as unknown as typeof fetch;
  const fresh = worker(); let loads = 0;
  const transport = createAnonRpcTransport({ loadWorker: async () => () => ++loads === 1 ? old : fresh });
  const oldRequest = transport.request<string>('eth_chainId'); const rejected = oldRequest.catch(error => error);
  await tick(); transport.stop(); expect(await transport.request<string>('eth_chainId')).toBe('0x1fcd');
  response.resolve(Response.json({ jsonrpc: '2.0', id: 1, result: '0x539' }));
  expect((await rejected as Error).name).toBe('AbortError'); expect(transport.getStatus().requestCount).toBe(1); transport.stop();
});

test('reconnecting during response decoding rejects stale data and counters', async () => {
  const decoded = deferred<unknown>(); const decoding = deferred<void>(); const old = worker();
  old.fetch = (async (_url, init) => {
    const { id } = JSON.parse(String(init?.body));
    return { ok: true, json: () => { decoding.resolve(); return decoded.promise.then(() => ({ jsonrpc: '2.0', id, result: '0x539' })); } } as Response;
  }) as typeof fetch;
  let loads = 0; const fresh = worker();
  const transport = createAnonRpcTransport({ loadWorker: async () => () => ++loads === 1 ? old : fresh });
  const rejected = transport.request<string>('eth_chainId').catch(error => error);
  await decoding.promise; transport.stop();
  expect(await transport.request<string>('eth_chainId')).toBe('0x1fcd');
  decoded.resolve(null);
  expect((await rejected as Error).name).toBe('AbortError');
  expect(transport.getStatus().requestCount).toBe(1); transport.stop();
});


test('closing a timed-out worker preserves the timeout reason instead of worker-closed', async () => {
  const ready = deferred<void>();
  const stuck = worker(ready.promise);
  stuck.close = () => { ready.reject(Error('worker closed')); };
  const transport = createAnonRpcTransport({ loadWorker: async () => () => stuck, bootTimeoutMs: 10 });
  await expect(transport.request('eth_chainId')).rejects.toThrow('boot-timeout');
  expect(transport.getStatus().detail).toContain('did not become ready');
  transport.stop();
});
