import { describe, expect, test } from 'bun:test';
import { fromRlp } from 'viem';
import { Frame, FrameTx, decodeFrameTransaction } from '../packages/frame-account/src/frametx';
import { frameToSidecar, submitToSidecar } from '../packages/frame-account/src/alt-mempool';
const tx = (chainId = 1337) => new FrameTx({ chainId, sender: 1n, nonceSeq: 0, maxFee: 128, maxPriorityFee: 1,
  frames: [new Frame({ mode: 1, flags: 3, target: 1n, gasLimit: 30000 })] });
describe('EF sidecar', () => {
  test('binds the nine-field envelope and round trips exactly', () => {
    const t = tx();
    const rlp = fromRlp(t.encode());
    expect(rlp).toHaveLength(9);
    expect(rlp[8]).toEqual([]);
    expect(decodeFrameTransaction(t.raw()).raw()).toBe(t.raw());
    expect(frameToSidecar(t).nonceKeys).toEqual(['0x0']);
    expect(frameToSidecar(t).recentRootReferences).toEqual([]);
    expect(() => frameToSidecar(tx(8141))).toThrow('chain 1337');
  });
  test('submits only to the sidecar and validates its hash', async () => {
    const t = tx(); const calls: string[] = [];
    const rpc = { async request<T>(method: string): Promise<T> { calls.push(method); return t.transactionHash() as T; } };
    expect(await submitToSidecar(rpc, t.raw())).toBe(t.transactionHash());
    expect(calls).toEqual(['eth_sendFrameTransaction']);
    await expect(submitToSidecar({ async request<T>(): Promise<T> { return '0x00' as T; } }, t.raw())).rejects.toThrow('another transaction');
  });
});

test('known sidecar submissions preserve the original transaction hash', async () => {
  const t=tx();let calls=0;
  const rpc={async request<T>():Promise<T>{calls++;throw Error('Frame transaction already known');}};
  expect(await submitToSidecar(rpc,t.raw())).toBe(t.transactionHash());
  expect(calls).toBe(1);
  await expect(submitToSidecar({async request<T>():Promise<T>{throw Error('invalid signature');}},t.raw())).rejects.toThrow('invalid signature');
});
