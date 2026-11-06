import { expect, test } from 'bun:test';
import { deriveVaultKey, sealWallet, toBase64, unsealWallet, type WalletSecrets } from '../src/lib/pq/vault';
import { readWalletCollection, upsertWallet, walletName } from '../src/lib/pq/wallet-collection';

async function fixture() {
  const metadata = { kind: 'qraft-passkey-wallet' as const, version: 1 as const, rpId: 'localhost', origin: 'http://localhost:3000', credentialId: toBase64(new Uint8Array(32).fill(3)), prfSalt: toBase64(new Uint8Array(32).fill(4)), hkdfSalt: toBase64(new Uint8Array(32).fill(5)) };
  const session = { metadata, key: await deriveVaultKey(new Uint8Array(32).fill(9), metadata) };
  const secrets: WalletSecrets = { version: 1, algorithm: 'ML-DSA-44', chainId: 8141, genesisHash: `0x${'ab'.repeat(32)}`, publicKey: `0x${'cd'.repeat(1312)}`, address: `0x${'ef'.repeat(20)}`, seed: `0x${'42'.repeat(32)}` };
  return { session, secrets, vault: await sealWallet(secrets, session) };
}

test('single-wallet migration preserves encrypted custody and assigns Wallet 1', async () => {
  const f = await fixture(); const wallets = readWalletCollection(null, f.vault);
  expect(wallets.length).toBe(1); expect(wallets[0]!.name).toBe('Wallet 1');
  expect(wallets[0]!.vault).toEqual(f.vault);
  expect(JSON.stringify(wallets)).not.toContain(f.secrets.seed);
  expect(await unsealWallet(wallets[0]!.vault, f.session)).toEqual(f.secrets);
});

test('new wallets preserve existing names and updating a vault does not duplicate it', async () => {
  const f = await fixture();
  const first = [{ name: 'Deposits', vault: f.vault }];
  const second = await sealWallet({ ...f.secrets, publicKey: `0x${'ab'.repeat(1312)}` }, f.session);
  const wallets = upsertWallet(first, second);
  expect(wallets.map(wallet => wallet.name)).toEqual(['Deposits', 'Wallet 2']);
  const refreshed = await sealWallet(f.secrets, f.session);
  const updated = upsertWallet(wallets, refreshed);
  expect(updated.length).toBe(2); expect(updated[0]!.name).toBe('Deposits');
  expect(updated[0]!.vault.ciphertext).toBe(refreshed.ciphertext);
  expect(readWalletCollection(JSON.stringify(updated), second).length).toBe(2);
});

test('wallet collection rejects plaintext additions and malformed or duplicated identities', async () => {
  const f = await fixture();
  expect(() => readWalletCollection(JSON.stringify([{ name: 'Wallet 1', vault: f.vault, seed: f.secrets.seed }]), null)).toThrow();
  expect(() => readWalletCollection(JSON.stringify([{ name: 'A', vault: f.vault }, { name: 'B', vault: f.vault }]), null)).toThrow('duplicate');
  expect(() => readWalletCollection('broken', f.vault)).toThrow();
  expect(walletName('  Spending  ', 'Wallet 1')).toBe('Spending');
  expect(walletName('   ', 'Wallet 1')).toBe('Wallet 1');
});
