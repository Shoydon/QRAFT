import { parseWalletVault, type WalletVault } from './vault';

export const WALLET_COLLECTION_KEY = 'qraft:wallets:v1';
export interface SavedWallet { name: string; vault: WalletVault }

export function nextWalletName(wallets: readonly SavedWallet[]): string {
  let number = wallets.length + 1;
  while (wallets.some(wallet => wallet.name === `Wallet ${number}`)) number++;
  return `Wallet ${number}`;
}

export function walletName(name: string, fallback: string): string {
  return name.trim().slice(0, 48) || fallback;
}

/** Names are public metadata; signing secrets remain inside validated encrypted vaults. */
export function readWalletCollection(text: string | null, active: WalletVault | null): SavedWallet[] {
  let wallets: SavedWallet[] = [];
  if (text) {
    if (text.length > 2_000_000) throw Error('The saved wallet list is too large.');
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || value.length > 100) throw Error('The saved wallet list could not be read.');
    wallets = value.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 2 || !('name' in entry) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 48 || !('vault' in entry)) throw Error('The saved wallet list could not be read.');
      return { name: entry.name, vault: parseWalletVault(JSON.stringify(entry.vault)) };
    });
    if (new Set(wallets.map(wallet => wallet.vault.publicKey.toLowerCase())).size !== wallets.length) throw Error('The saved wallet list contains duplicate identities.');
  }
  // Migrate the original single-wallet store without deleting or decrypting it.
  if (active) {
    const existing = wallets.find(wallet => wallet.vault.publicKey.toLowerCase() === active.publicKey.toLowerCase());
    if (existing) existing.vault = active;
    else wallets.push({ name: nextWalletName(wallets), vault: active });
  }
  return wallets;
}

export function upsertWallet(wallets: readonly SavedWallet[], vault: WalletVault): SavedWallet[] {
  const existing = wallets.find(wallet => wallet.vault.publicKey.toLowerCase() === vault.publicKey.toLowerCase());
  return existing
    ? wallets.map(wallet => wallet === existing ? { ...wallet, vault } : wallet)
    : [...wallets, { name: nextWalletName(wallets), vault }];
}
