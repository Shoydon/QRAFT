'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { createKey } from '../../packages/pq-account/src/keys';
import manifest from '../../public/pq-deployment.json';
import { PqAccountClient } from '@/lib/pq/account';
import type { ChainTransport } from '@/lib/transport/types';
import { WALLET_VAULT_KEY, parseWalletVault, parseWalletSecrets, registerWalletPasskey, unlockWalletVault, unsealWallet, sealWallet, storeWalletVault, type VaultSession, type WalletVault, type WalletSecrets } from '@/lib/pq/vault';

const CHANGE = 'qraft-wallet-vault-change';
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener); window.addEventListener(CHANGE, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(CHANGE, listener); };
}
const snapshot = () => localStorage.getItem(WALLET_VAULT_KEY);
const serverSnapshot = () => null;
function localhostSnapshot() {
  if (window.location.hostname !== '127.0.0.1' && window.location.hostname !== '[::1]') return null;
  const url = new URL(window.location.href); url.hostname = 'localhost'; return url.href;
}
export interface WalletConnection {
  seed?: Uint8Array; plaintextBackup?: string; backupAcknowledged?: boolean;
  alreadyBusy?: boolean; onReady?: (client: PqAccountClient) => Promise<void>;
  signal?: AbortSignal;
}
interface Actions {
  hasVault: boolean; protected: boolean; primaryLabel: string; localhostUrl: string | null;
  create(): Promise<void>; importFile(file: File): Promise<void>;
  download(): void; confirmBackup(): Promise<void>; lock(): void;
}
interface Props {
  account: PqAccountClient | null; transport: ChainTransport | null;
  getPendingSeed(): Uint8Array | null; setPendingSeed(seed: Uint8Array | null): void;
  begin(label: string, operation?: 'transaction' | 'wallet:create' | 'wallet:import'): boolean;
  end(): void; show(): void; error(message: string | null): void;
  connect(file?: File, options?: WalletConnection): Promise<PqAccountClient | null>;
  exportEncrypted(text: string): void; confirm(): void; lock(): void;
  requireProtection(): void;
  onSetupStart?(): void;
  children(actions: Actions): ReactNode;
}

export function WalletPasskeyController(props: Props) {
  const text = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const localhostUrl = useSyncExternalStore(subscribe, localhostSnapshot, serverSnapshot);
  const parsed = useMemo(() => {
    try { return { vault: text ? parseWalletVault(text) : null, error: null }; }
    catch { return { vault: null, error: 'The saved encrypted wallet could not be read. Import its encrypted backup.' }; }
  }, [text]);
  const session = useRef<VaultSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  function store(vault: WalletVault) {
    storeWalletVault(vault); window.dispatchEvent(new Event(CHANGE));
  }
  async function run(action: 'wallet:create' | 'wallet:import', work: (signal: AbortSignal) => Promise<void>) {
    if (!props.begin(action === 'wallet:import' ? 'Unlocking the wallet backup' : 'Verifying your passkey', action)) return;
    props.error(null); controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try { await work(abort.signal); }
    catch (error) {
      if (!mounted.current || abort.signal.aborted) return;
      props.error(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Passkey verification was not completed. Try again when you are ready.'
        : error instanceof Error ? error.message : 'The passkey could not unlock this wallet.');
    } finally { if (controller.current === abort) controller.current = null; if (mounted.current) props.end(); }
  }
  function checkNetwork(secrets: WalletSecrets) {
    if (secrets.chainId !== manifest.chainId || secrets.genesisHash !== manifest.genesisHash) throw Error('This wallet belongs to a different devnet.');
  }
  async function connect(secrets: WalletSecrets, activeSession: VaultSession, acknowledged: boolean, signal: AbortSignal, file?: File) {
    checkNetwork(secrets); signal.throwIfAborted();
    const complete = async (client: PqAccountClient) => {
      signal.throwIfAborted();
      const vault = await sealWallet(parseWalletSecrets(client.backup()), activeSession, acknowledged);
      signal.throwIfAborted(); store(vault); session.current = activeSession;
    };
    const seed = secrets.address ? null : hexToBytes(secrets.seed);
    try {
      await props.connect(file, { alreadyBusy: true, backupAcknowledged: acknowledged, signal,
        ...(seed ? { seed } : { plaintextBackup: JSON.stringify(secrets) }), onReady: complete });
    } finally { seed?.fill(0); }
  }
  async function unlock(vault: WalletVault, signal: AbortSignal, file?: File) {
    const unlocked = session.current
      ? { session: session.current, secrets: await unsealWallet(vault, session.current) }
      : await unlockWalletVault(vault, signal);
    signal.throwIfAborted(); session.current = unlocked.session;
    await connect(unlocked.secrets, unlocked.session, file ? true : vault.backupAcknowledged, signal, file);
  }
  async function create() {
    await run('wallet:create', async signal => {
      if (parsed.error) throw Error(parsed.error);
      if (!props.account && !parsed.vault?.address) props.onSetupStart?.();
      if (props.account && !parsed.vault) {
        const active = await registerWalletPasskey(signal);
        store(await sealWallet(parseWalletSecrets(props.account.backup()), active, false)); session.current = active; return;
      }
      if (parsed.vault) { await unlock(parsed.vault, signal); return; }
      const active = await registerWalletPasskey(signal);
      const seed = props.getPendingSeed() ?? crypto.getRandomValues(new Uint8Array(32));
      props.setPendingSeed(seed);
      const key = createKey(seed);
      const secrets: WalletSecrets = { version: 1, algorithm: 'ML-DSA-44', chainId: manifest.chainId, genesisHash: manifest.genesisHash as Hex, publicKey: bytesToHex(key.publicKey), address: null, seed: bytesToHex(seed) };
      key.seed.fill(0);
      store(await sealWallet(secrets, active, false)); session.current = active;
      // Persist encryption before any deployment request, so a reload can resume this key.
      await connect(secrets, active, false, signal);
    });
  }
  async function importFile(file: File) {
    await run('wallet:import', async signal => {
      if (file.size > 32768) throw Error('The wallet backup is too large.');
      const value = await file.text();
      const candidate = JSON.parse(value) as { kind?: unknown };
      if (candidate?.kind === 'qraft-passkey-wallet') {
        const vault = parseWalletVault(value); const unlocked = await unlockWalletVault(vault, signal);
        await connect(unlocked.secrets, unlocked.session, true, signal, file); return;
      }
      // Explicit legacy import is immediately protected; no plaintext copy is saved.
      const secrets = parseWalletSecrets(value); checkNetwork(secrets);
      const active = await registerWalletPasskey(signal);
      await connect(secrets, active, true, signal, file);
    });
  }
  function download() {
    if (!parsed.vault || !props.account || parsed.vault.address?.toLowerCase() !== props.account.address.toLowerCase()) { props.error('Protect this wallet with a passkey before exporting its backup.'); return; }
    props.exportEncrypted(JSON.stringify(parsed.vault));
  }
  async function confirmBackup() {
    if (!props.account || !parsed.vault) return;
    await run('wallet:create', async signal => {
      const active = session.current ?? (await unlockWalletVault(parsed.vault!, signal)).session;
      store(await sealWallet(parseWalletSecrets(props.account!.backup()), active, true)); session.current = active;
      props.confirm();
    });
  }
  function lock() {
    controller.current?.abort(); session.current = null; props.getPendingSeed()?.fill(0); props.setPendingSeed(null); props.lock();
  }
  const requireProtection = useEffectEvent(() => { if (props.account && !parsed.vault) props.requireProtection(); });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); session.current = null; };
  }, [props.transport]);
  useEffect(() => { requireProtection(); }, [props.account, text]);

  // These callbacks access refs only when invoked by child event handlers.
  // eslint-disable-next-line react-hooks/refs
  return props.children({ localhostUrl, hasVault: !!text, protected: !!parsed.vault && !!props.account && parsed.vault.address?.toLowerCase() === props.account.address.toLowerCase(),
    primaryLabel: parsed.vault ? parsed.vault.address ? 'Unlock with passkey' : 'Resume wallet setup' : props.account ? 'Protect with passkey' : 'Create PQ wallet',
    create, importFile, download, confirmBackup, lock });
}
