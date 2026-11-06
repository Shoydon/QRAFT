import { expect, test } from 'bun:test';
import { deriveVaultKey, sealWallet, unsealWallet, parseWalletVault, toBase64, type WalletSecrets, type VaultSession } from '../src/lib/pq/vault';

const secrets: WalletSecrets = { version: 1, algorithm: 'ML-DSA-44', chainId: 8141, genesisHash: `0x${'ab'.repeat(32)}`, publicKey: `0x${'cd'.repeat(1312)}`, address: `0x${'ef'.repeat(20)}`, seed: `0x${'42'.repeat(32)}` };
async function session(byte = 1): Promise<VaultSession> {
  const metadata = { kind: 'qraft-passkey-wallet' as const, version: 1 as const, rpId: 'localhost', origin: 'http://localhost:3000', credentialId: toBase64(new Uint8Array(32).fill(3)), prfSalt: toBase64(new Uint8Array(32).fill(4)), hkdfSalt: toBase64(new Uint8Array(32).fill(5)) };
  return { metadata, key: await deriveVaultKey(new Uint8Array(32).fill(byte), metadata) };
}
test('encrypted wallet round trip uses nonextractable keys and fresh IVs without a plaintext seed', async () => {
  const active = await session(); const vault = await sealWallet(secrets, active);
  expect(active.key.extractable).toBe(false);
  expect(JSON.stringify(vault)).not.toContain(secrets.seed);
  expect(Object.hasOwn(vault, 'seed')).toBe(false);
  expect(await unsealWallet(parseWalletVault(JSON.stringify(vault)), active)).toEqual(secrets);
  const second = await sealWallet(secrets, active);
  expect(second.iv).not.toBe(vault.iv); expect(second.ciphertext).not.toBe(vault.ciphertext);
});
test('wrong passkey, changed ciphertext and changed public metadata cannot decrypt a wallet', async () => {
  const active = await session(); const vault = await sealWallet(secrets, active);
  await expect(unsealWallet(vault, await session(2))).rejects.toThrow('cannot unlock');
  await expect(unsealWallet({ ...vault, ciphertext: (vault.ciphertext[0] === 'A' ? 'B' : 'A') + vault.ciphertext.slice(1) }, active)).rejects.toThrow('cannot unlock');
  for (const change of [{ backupAcknowledged: true }, { address: null }, { chainId: 1 }, { credentialId: 'AAAA' }]) {
    await expect(unsealWallet({ ...vault, ...change }, active)).rejects.toThrow('cannot unlock');
  }
});
test('encrypted format rejects plaintext fields and malformed buffers', async () => {
  const vault = await sealWallet(secrets, await session());
  expect(() => parseWalletVault(JSON.stringify({ ...vault, seed: secrets.seed }))).toThrow();
  expect(() => parseWalletVault(JSON.stringify({ ...vault, iv: 'AA' }))).toThrow();
  expect(() => parseWalletVault(JSON.stringify(secrets))).toThrow();
});
