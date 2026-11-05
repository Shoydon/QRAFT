'use client';

import { getAddress, type Hex } from 'viem';
import { DEPLOYMENT } from '@/config/pool';
import type { AccountAdapter, AccountState } from './types';
import { getScenario } from './scenario';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
  isMetaMask?: boolean;
  isRabby?: boolean;
}

const EMPTY: AccountState = {
  status: 'disconnected',
  address: null,
  chainId: null,
  balanceWei: null,
  providerLabel: null,
  error: null,
  simulated: false,
};

function store(initial: AccountState) {
  let state = initial;
  const listeners = new Set<(s: AccountState) => void>();
  return {
    get: () => state,
    set(next: Partial<AccountState>) {
      state = { ...state, ...next };
      for (const l of listeners) l(state);
    },
    subscribe(listener: (s: AccountState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

function detectInjected(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
  return injected && typeof injected.request === 'function' ? injected : null;
}

function labelFor(provider: Eip1193Provider): string {
  if (provider.isRabby) return 'Rabby';
  if (provider.isMetaMask) return 'MetaMask';
  return 'Browser wallet';
}

/**
 * Real EIP-1193 wallet. Account, chain and balance are live; only submission
 * is simulated in this build.
 *
 * Never calls `eth_requestAccounts` outside `connect()`, so no wallet prompt
 * opens on page load. `resume()` uses the non-prompting `eth_accounts`.
 */
export function injectedAccountAdapter(provider: Eip1193Provider): AccountAdapter {
  const s = store({ ...EMPTY, providerLabel: labelFor(provider) });

  async function readChain(): Promise<number | null> {
    try {
      const hex = (await provider.request({ method: 'eth_chainId' })) as string;
      return Number(BigInt(hex));
    } catch {
      return null;
    }
  }

  async function readBalance(address: Hex): Promise<bigint | null> {
    try {
      const hex = (await provider.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      })) as string;
      return BigInt(hex);
    } catch {
      return null;
    }
  }

  async function adopt(accounts: unknown) {
    const list = Array.isArray(accounts) ? (accounts as string[]) : [];
    const first = list[0];
    if (!first) {
      s.set({ status: 'disconnected', address: null, chainId: null, balanceWei: null });
      return;
    }
    const address = getAddress(first);
    const chainId = await readChain();
    s.set({ status: 'connected', address, chainId, error: null });
    s.set({ balanceWei: await readBalance(address) });
  }

  provider.on?.('accountsChanged', ((accounts: unknown) => {
    void adopt(accounts);
  }) as never);
  provider.on?.('chainChanged', (() => {
    void (async () => {
      const chainId = await readChain();
      s.set({ chainId });
      const { address } = s.get();
      if (address) s.set({ balanceWei: await readBalance(address) });
    })();
  }) as never);

  return {
    getState: s.get,
    subscribe: s.subscribe,

    async resume() {
      try {
        await adopt(await provider.request({ method: 'eth_accounts' }));
      } catch {
        /* An unauthorized wallet simply reports nothing. Not an error state. */
      }
    },

    async connect() {
      s.set({ status: 'connecting', error: null });
      try {
        await adopt(await provider.request({ method: 'eth_requestAccounts' }));
      } catch (error) {
        const rejected = isUserRejection(error);
        s.set({
          status: 'disconnected',
          error: rejected
            ? 'Connection was declined in your wallet. Choose Connect wallet to try again.'
            : `Your wallet could not connect: ${message(error)}`,
        });
      }
    },

    async disconnect() {
      s.set({ ...EMPTY, providerLabel: s.get().providerLabel });
    },

    async switchChain(chainId: number) {
      const hexChainId = `0x${chainId.toString(16)}`;
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        });
      } catch (error) {
        if (!isUnknownChain(error)) {
          s.set({
            error: isUserRejection(error)
              ? `Your wallet stayed on its current network. ${DEPLOYMENT.chainName} is required to deposit.`
              : `Could not switch network: ${message(error)}`,
          });
          return;
        }
        s.set({
          error: `Your wallet does not have ${DEPLOYMENT.chainName} configured. Add it in your wallet, then try again.`,
        });
      }
    },

    async refreshBalance() {
      const { address } = s.get();
      if (address) s.set({ balanceWei: await readBalance(address) });
    },
  };
}

/**
 * Simulated account, used when the browser has no wallet. Every value it
 * reports is marked simulated so the interface can label it.
 */
export function simulatedAccountAdapter(): AccountAdapter {
  const address = '0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as Hex;
  const s = store({ ...EMPTY, providerLabel: 'Simulated wallet', simulated: true });

  const balance = () =>
    getScenario() === 'insufficient-balance' ? 4_000_000_000_000_000n : 2n * 10n ** 18n;

  return {
    getState: s.get,
    subscribe: s.subscribe,
    async resume() {
      /* A simulated wallet never auto-connects. */
    },
    async connect() {
      s.set({ status: 'connecting', error: null });
      await wait(420);
      s.set({
        status: 'connected',
        address,
        chainId: DEPLOYMENT.chainId,
        balanceWei: balance(),
        error: null,
      });
    },
    async disconnect() {
      s.set({ ...EMPTY, providerLabel: 'Simulated wallet', simulated: true });
    },
    async switchChain(chainId: number) {
      await wait(200);
      s.set({ chainId, error: null });
    },
    async refreshBalance() {
      s.set({ balanceWei: s.get().address ? balance() : null });
    },
  };
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function resolveAccountAdapter(): AccountAdapter {
  const injected = detectInjected();
  return injected ? injectedAccountAdapter(injected) : simulatedAccountAdapter();
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown error';
}

function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === 4001) return true;
  if (typeof e.message === 'string' && /user (rejected|denied)/i.test(e.message)) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

function isUnknownChain(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === 4902) return true;
  if (typeof e.message === 'string' && /unrecognized chain|unknown chain/i.test(e.message))
    return true;
  return e.cause ? isUnknownChain(e.cause) : false;
}
