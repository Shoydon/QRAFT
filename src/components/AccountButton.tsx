'use client';

import { DEPLOYMENT } from '@/config/pool';
import { formatEth, truncateMiddle } from '@/lib/format';
import type { AccountState, Backend } from '@/lib/adapters/types';
import { Button } from './primitives';
import { WalletIcon } from './icons';

/**
 * Contextual account control. Connecting only ever happens from a click here
 * or from the deposit flow's own connect step — never on load.
 */
export function AccountButton({
  account,
  backend,
}: {
  account: AccountState;
  backend: Backend | null;
}) {
  const wrongNetwork =
    account.status === 'connected' &&
    account.chainId !== null &&
    account.chainId !== DEPLOYMENT.chainId;

  if (account.status !== 'connected') {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={<WalletIcon width={15} height={15} />}
        busy={account.status === 'connecting'}
        onClick={() => void backend?.account.connect()}
      >
        {account.status === 'connecting' ? 'Connecting' : 'Connect wallet'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {wrongNetwork ? (
        <Button
          variant="secondary"
          size="sm"
          className="border-state-bad/40 text-state-bad hover:border-state-bad"
          onClick={() => void backend?.account.switchChain(DEPLOYMENT.chainId)}
        >
          Switch to {DEPLOYMENT.chainName}
        </Button>
      ) : null}
      <div className="flex items-center gap-2 rounded-control border border-rule bg-surface px-2.5 py-1.5">
        <span className="flex flex-col leading-tight">
          <span className="font-mono text-[0.75rem] text-ink" data-numeric>
            {truncateMiddle(account.address ?? '', 6, 4)}
          </span>
          <span className="text-[0.625rem] text-ink-60">
            {account.balanceWei === null
              ? (account.providerLabel ?? 'Wallet')
              : `${formatEth(account.balanceWei, 4)} ETH`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void backend?.account.disconnect()}
          className="rounded px-1 text-[0.6875rem] font-medium text-ink-60 transition-colors hover:text-ink"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
