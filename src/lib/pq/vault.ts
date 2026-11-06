import manifest from '../../../public/pq-deployment.json';
/** Browser-only encrypted custody. WebAuthn PRF output never leaves this device. */
import type { Hex } from 'viem';

export const WALLET_VAULT_KEY = `qraft:passkey-wallet:v1:${manifest.chainId}`;
const encoder = new TextEncoder();
const KIND = 'qraft-passkey-wallet';
export interface WalletSecrets {
  version: 1; algorithm: 'ML-DSA-44'; chainId: number; genesisHash: Hex;
  publicKey: Hex; address: Hex | null; seed: Hex;
}
interface PasskeyMetadata {
  kind: typeof KIND; version: 1; rpId: string; origin: string;
  credentialId: string; prfSalt: string; hkdfSalt: string;
}
export interface WalletVault extends PasskeyMetadata {
  chainId: number; genesisHash: Hex; publicKey: Hex; address: Hex | null;
  backupAcknowledged: boolean; iv: string; ciphertext: string;
}
export interface VaultSession { metadata: PasskeyMetadata; key: CryptoKey }
type PrfInputs = AuthenticationExtensionsClientInputs & { prf: { eval: { first: ArrayBuffer } } };
type PrfOutputs = AuthenticationExtensionsClientOutputs & { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const isHex = (value: unknown, bytes: number): value is Hex => typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
export function toBase64(bytes: Uint8Array): string {
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw Error('Invalid encrypted wallet encoding.');
  const decoded = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
export function parseWalletSecrets(text: string): WalletSecrets {
  if (text.length > 8192) throw Error('The wallet backup is too large.');
  const value = JSON.parse(text) as WalletSecrets;
  const fields = ['version', 'algorithm', 'chainId', 'genesisHash', 'publicKey', 'address', 'seed'];
  if (!value || typeof value !== 'object' || Object.keys(value).length !== fields.length || Object.keys(value).some(field => !fields.includes(field)) || value.version !== 1 || value.algorithm !== 'ML-DSA-44' || !Number.isSafeInteger(value.chainId) || !isHex(value.genesisHash, 32) || !isHex(value.publicKey, 1312) || !isHex(value.seed, 32) || (value.address !== null && !isHex(value.address, 20))) throw Error('Choose a valid QRAFT wallet backup.');
  return value;
}
export function parseWalletVault(text: string): WalletVault {
  if (text.length > 32768) throw Error('The encrypted wallet backup is too large.');
  const value = JSON.parse(text) as WalletVault;
  const fields = ['kind', 'version', 'rpId', 'origin', 'credentialId', 'prfSalt', 'hkdfSalt', 'chainId', 'genesisHash', 'publicKey', 'address', 'backupAcknowledged', 'iv', 'ciphertext'];
  if (!value || typeof value !== 'object' || Object.keys(value).length !== fields.length || Object.keys(value).some(field => !fields.includes(field)) || value.kind !== KIND || value.version !== 1 || typeof value.rpId !== 'string' || value.rpId.length > 253 || typeof value.origin !== 'string' || value.origin.length > 1024 || new URL(value.origin).hostname !== value.rpId || typeof value.credentialId !== 'string' || value.credentialId.length > 4096 || fromBase64(value.credentialId).length === 0 || typeof value.backupAcknowledged !== 'boolean' || !Number.isSafeInteger(value.chainId) || !isHex(value.genesisHash, 32) || !isHex(value.publicKey, 1312) || (value.address !== null && !isHex(value.address, 20)) || typeof value.ciphertext !== 'string' || value.ciphertext.length > 22000 || fromBase64(value.ciphertext).length < 16 || fromBase64(value.prfSalt).length !== 32 || fromBase64(value.hkdfSalt).length !== 32 || fromBase64(value.iv).length !== 12) throw Error('Choose a valid encrypted QRAFT wallet backup.');
  return value;
}
function aad(vault: Omit<WalletVault, 'iv' | 'ciphertext'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([vault.kind, vault.version, vault.rpId, vault.origin, vault.credentialId, vault.prfSalt, vault.hkdfSalt, vault.chainId, vault.genesisHash, vault.publicKey, vault.address, vault.backupAcknowledged]));
}
export async function deriveVaultKey(output: Uint8Array<ArrayBuffer>, metadata: PasskeyMetadata): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: fromBase64(metadata.hkdfSalt), info: encoder.encode(`${KIND}:v1:${metadata.rpId}`) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealWallet(secrets: WalletSecrets, session: VaultSession, backupAcknowledged = false): Promise<WalletVault> {
  parseWalletSecrets(JSON.stringify(secrets));
  const header = { ...session.metadata, chainId: secrets.chainId, genesisHash: secrets.genesisHash, publicKey: secrets.publicKey, address: secrets.address, backupAcknowledged };
  const iv = random(12), plaintext = encoder.encode(JSON.stringify(secrets));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header), tagLength: 128 }, session.key, plaintext);
    return { ...header, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  } finally { plaintext.fill(0); }
}
export async function unsealWallet(vault: WalletVault, session: VaultSession): Promise<WalletSecrets> {
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv), additionalData: aad(vault), tagLength: 128 }, session.key, fromBase64(vault.ciphertext))); }
  catch { throw Error('This passkey cannot unlock the encrypted wallet, or the backup was changed.'); }
  try {
    const secrets = parseWalletSecrets(new TextDecoder().decode(bytes));
    if (secrets.chainId !== vault.chainId || secrets.genesisHash !== vault.genesisHash || secrets.publicKey !== vault.publicKey || secrets.address !== vault.address) throw Error('The encrypted wallet identity does not match.');
    return secrets;
  } finally { bytes.fill(0); }
}
function capability(): void {
  if (window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]') throw Error('Open this app on localhost to use passkeys. IP addresses cannot be passkey domains.');
  if (!globalThis.isSecureContext || !navigator.credentials || typeof PublicKeyCredential === 'undefined') throw Error('Passkeys require a secure browser page. Use localhost or HTTPS.');
}
function checkedCredential(credential: Credential | null, challenge: Uint8Array, rpId: string, type: string): PublicKeyCredential {
  if (!(credential instanceof PublicKeyCredential)) throw Error('Passkey verification was not completed.');
  const client = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON)) as { type?: string; challenge?: string; origin?: string };
  if (client.type !== type || client.challenge !== toBase64(challenge) || client.origin !== window.location.origin) throw Error('The passkey response does not match this wallet request.');
  if (rpId !== window.location.hostname) throw Error('Open the original wallet domain to use this passkey.');
  const response = credential.response;
  const authenticatorData = response instanceof AuthenticatorAssertionResponse ? response.authenticatorData : (response as AuthenticatorAttestationResponse).getAuthenticatorData();
  if (new Uint8Array(authenticatorData).length < 37 || !(new Uint8Array(authenticatorData)[32]! & 4)) throw Error('Verify your identity with the passkey before unlocking this wallet.');
  return credential;
}
export async function authenticate(metadata: PasskeyMetadata, signal?: AbortSignal): Promise<VaultSession> {
  capability();
  if (metadata.rpId !== window.location.hostname) throw Error('Open the original wallet domain to unlock this backup.');
  const challenge = random(32);
  const result = await navigator.credentials.get({ signal, mediation: 'required', publicKey: { challenge, rpId: metadata.rpId, allowCredentials: [{ type: 'public-key', id: fromBase64(metadata.credentialId) }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: fromBase64(metadata.prfSalt).buffer } } } as PrfInputs } });
  const credential = checkedCredential(result, challenge, metadata.rpId, 'webauthn.get');
  if (toBase64(new Uint8Array(credential.rawId)) !== metadata.credentialId) throw Error('Choose the passkey that protects this wallet.');
  const output = (credential.getClientExtensionResults() as PrfOutputs).prf?.results?.first;
  if (!output || output.byteLength !== 32) throw Error('This passkey provider does not support wallet encryption (WebAuthn PRF). Choose a compatible passkey.');
  const bytes = new Uint8Array(output);
  try { return { metadata, key: await deriveVaultKey(bytes, metadata) }; } finally { bytes.fill(0); }
}
export async function registerWalletPasskey(signal?: AbortSignal): Promise<VaultSession> {
  capability();
  const rpId = window.location.hostname, challenge = random(32), prfSalt = random(32);
  const result = await navigator.credentials.create({ signal, publicKey: { challenge, rp: { id: rpId, name: 'QRAFT' }, user: { id: random(32), name: 'QRAFT wallet', displayName: 'QRAFT wallet' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, attestation: 'none', timeout: 60000, extensions: { prf: { eval: { first: prfSalt.buffer } } } as PrfInputs } });
  const credential = checkedCredential(result, challenge, rpId, 'webauthn.create');
  const metadata: PasskeyMetadata = { kind: KIND, version: 1, rpId, origin: window.location.origin, credentialId: toBase64(new Uint8Array(credential.rawId)), prfSalt: toBase64(prfSalt), hkdfSalt: toBase64(random(32)) };
  const prf = (credential.getClientExtensionResults() as PrfOutputs).prf;
  if (!prf?.enabled && !prf?.results?.first) throw Error('This passkey cannot encrypt wallets. Choose a passkey provider with WebAuthn PRF support.');
  if (!prf.results?.first) return authenticate(metadata, signal);
  if (prf.results.first.byteLength !== 32) throw Error("The passkey returned invalid wallet encryption material.");
  const output = new Uint8Array(prf.results.first);
  try { return { metadata, key: await deriveVaultKey(output, metadata) }; } finally { output.fill(0); }
}
export async function unlockWalletVault(vault: WalletVault, signal?: AbortSignal): Promise<{ session: VaultSession; secrets: WalletSecrets }> {
  const session = await authenticate(vault, signal);
  return { session, secrets: await unsealWallet(vault, session) };
}
export function loadWalletVault(): WalletVault | null { const text = localStorage.getItem(WALLET_VAULT_KEY); return text ? parseWalletVault(text) : null; }
export function storeWalletVault(vault: WalletVault): void { parseWalletVault(JSON.stringify(vault)); localStorage.setItem(WALLET_VAULT_KEY, JSON.stringify(vault)); }
