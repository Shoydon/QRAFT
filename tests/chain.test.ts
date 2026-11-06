import { expect, test } from 'bun:test';
import type { Hex } from 'viem';
import { DEPLOYMENT, DEPLOYMENT_MANIFEST } from '../src/config/pool';
import { chainBackend } from '../src/lib/adapters/chain';
import { createNote } from '../src/lib/note';
import type { ChainTransport } from '../src/lib/transport/types';

function transport(wrongChain: boolean) {
  const methods: string[] = [];
  const rpc: ChainTransport = {
    getStatus: () => ({ phase: 'ready', network: 'test', detail: null, code: null, lastLatencyMs: 0, requestCount: methods.length }),
    subscribe: () => () => {}, start() {}, stop() {},
    async request<T>(method: string, params: unknown[] = []): Promise<T> {
      methods.push(method);
      if (method === 'eth_chainId') return `0x${(DEPLOYMENT.chainId + (wrongChain ? 1 : 0)).toString(16)}` as T;
      if (method === 'eth_getCode') return '0x' as T;
      if (method === 'eth_getBlockByNumber') return { number: params[0], hash: params[0] === '0x0' ? DEPLOYMENT_MANIFEST.genesisHash : DEPLOYMENT_MANIFEST.anchorHash, timestamp: '0x0', transactions: [], gasLimit: '0x1000000', gasUsed: '0x0' } as T;
      throw Error('Unexpected RPC operation');
    },
  };
  return { rpc, methods };
}

for (const wrongChain of [true, false]) {
  test(`${wrongChain ? 'wrong chain' : 'missing runtime'} disables deposits before any wallet request`, async () => {
    const { rpc, methods } = transport(wrongChain);
    const backend = chainBackend(rpc);
    const pool = DEPLOYMENT.pools[0]!;
    const result = await backend.deposit.submit({ pool, commitment: createNote(pool).commitment, from: '0x0000000000000000000000000000000000000001' as Hex }, () => {});
    expect(result.kind).toBe('not-sent');
    expect(methods).not.toContain('eth_sendRawTransaction');
    expect(methods).not.toContain('eth_sendTransaction');
    expect(backend.account.getState().simulated).toBe(false);
  });
}

test('unreadable confirmation stays unknown instead of presenting a failed or successful transfer', async () => {
  const { rpc } = transport(true);
  const backend = chainBackend(rpc);
  const outcome = await backend.reconcile.check(`0x${'1'.repeat(64)}`);
  expect(outcome.kind).toBe('unknown');
});
