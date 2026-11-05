import type { Hex } from 'viem';
import type { Eip1193Provider } from './account';

/** Run after slow network work, immediately before asking a wallet to send. */
export async function assertWalletContext(provider: Eip1193Provider, chainId: number, from: Hex): Promise<void> {
  const [latestChain, latestAccounts] = await Promise.all([
    provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
  ]);
  if (typeof latestChain !== 'string' || !/^0x[0-9a-f]+$/i.test(latestChain) || Number(BigInt(latestChain)) !== chainId ||
    !Array.isArray(latestAccounts) || typeof latestAccounts[0] !== 'string' || latestAccounts[0].toLowerCase() !== from.toLowerCase()) {
    throw Error('Wallet network or account changed. Review the transaction again.');
  }
}
