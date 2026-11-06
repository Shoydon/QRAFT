import { expect, test } from 'bun:test';
import { numberToHex } from 'viem';
import { DEFAULT_PQ_POOL, validatePqPools } from '../src/lib/pq/registry';
import { createPqNote, parsePqNote, serializePqNote } from '../src/lib/pq/note';
const extra = { ...DEFAULT_PQ_POOL, pool: numberToHex(9991, { size: 20 }), paymaster: numberToHex(9992, { size: 20 }), denominationWei: '1000000000000000' };
test('distinct fixed pools preserve the original pool and bind notes to their amount and address', () => {
  const pools = validatePqPools(DEFAULT_PQ_POOL, [extra]);
  expect(pools.length).toBe(2); expect(pools[0]).toBe(DEFAULT_PQ_POOL);
  const text = serializePqNote(createPqNote(extra));
  expect(parsePqNote(text, pools[1]!).pool).toBe(extra.pool);
  expect(() => parsePqNote(text, pools[0]!)).toThrow();
  expect(() => parsePqNote(text, { ...extra, denominationWei: DEFAULT_PQ_POOL.denominationWei })).toThrow();
});
test('pool registry rejects conflicting identities, other networks, and substituted verifier infrastructure', () => {
  for (const changed of [{ pool: DEFAULT_PQ_POOL.pool }, { denominationWei: DEFAULT_PQ_POOL.denominationWei }, { paymaster: DEFAULT_PQ_POOL.paymaster }, { chainId: DEFAULT_PQ_POOL.chainId + 1 }, { verifier: numberToHex(44, { size: 20 }) }, { denominationWei: '0' }, { runtimeHash: '0x' }, { deploymentBlock: -1 }]) {
    expect(() => validatePqPools(DEFAULT_PQ_POOL, [{ ...extra, ...changed }])).toThrow();
  }
});

test('a proof context binds both pool address and exact denomination', async () => {
  const { withdrawalContext } = await import('../src/lib/pq/proof');
  const recipient = numberToHex(555, { size: 20 });
  const base = withdrawalContext(recipient, 2000000000n, DEFAULT_PQ_POOL);
  const selected = withdrawalContext(recipient, 2000000000n, extra);
  expect(selected.digest).not.toBe(base.digest);
  expect(selected.publicContext.poolHex).toBe(extra.pool);
  expect(selected.publicContext.denomination).toBe(extra.denominationWei);
  expect(withdrawalContext(recipient, 2000000000n, { ...extra, denominationWei: DEFAULT_PQ_POOL.denominationWei }).digest).not.toBe(selected.digest);
});
