import { expect, test } from 'bun:test';
import { assertWalletContext } from '../src/lib/adapters/wallet-context';
import type { Eip1193Provider } from '../src/lib/adapters/account';
const from = '0x0000000000000000000000000000000000000001';
function wallet(chain: unknown, accounts: unknown): Eip1193Provider {
  return { request: async ({ method }) => method === 'eth_chainId' ? chain : accounts };
}
test('a wallet switched to another chain while gas estimation waited is rejected', async () => {
  await expect(assertWalletContext(wallet('0x1', [from]), 8141, from)).rejects.toThrow('Wallet network or account changed');
});
test('changing the active account is rejected even if the old account remains authorized', async () => {
  await expect(assertWalletContext(wallet('0x1fcd', ['0x0000000000000000000000000000000000000002', from]), 8141, from)).rejects.toThrow();
});
test('disconnected and malformed wallet responses cannot authorize submission', async () => {
  await expect(assertWalletContext(wallet('0x1fcd', []), 8141, from)).rejects.toThrow();
  await expect(assertWalletContext(wallet(null, [from]), 8141, from)).rejects.toThrow();
});
test('the expected chain and active account pass the final pre-send check', async () => {
  await assertWalletContext(wallet('0x1fcd', [from]), 8141, from);
});
