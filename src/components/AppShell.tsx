'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WORDMARK } from '@/config/brand';
import { DEPLOYMENT } from '@/config/pool';
import { useAccountState, useBackend, useTransportStatus } from '@/hooks/useAdapters';
import { AccountButton } from './AccountButton';
import { ArrowLeftIcon } from './icons';
import { DepositPanel } from './DepositPanel';
import { ReadPathLine } from './DetailSheet';
import { WithdrawPanel } from './WithdrawPanel';

const TABS = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function AppShell() {
  const { backend, transport } = useBackend();
  const account = useAccountState(backend);
  const status = useTransportStatus(transport);
  const [tab, setTab] = useState<TabId>('deposit');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Reads begin on load; connecting a wallet does not. `resume` is the
  // non-prompting account lookup — it adopts an already authorized account
  // without opening a wallet dialog.
  useEffect(() => {
    transport?.start();
    void backend?.account.resume();
  }, [transport, backend]);

  function onTabKey(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (i + TABS.length - 1) % TABS.length
          : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-3.5 sm:px-6">
        <div className="mx-auto flex max-w-[32rem] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* The only link home. The wordmark beside it stays plain text, so
                assistive tech is not read two adjacent links to one place. */}
            <Link
              href="/"
              aria-label="Back to the QRAFT home page"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-sunk text-ink-60 shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)] transition-colors hover:bg-rule/60 hover:text-ink"
            >
              <ArrowLeftIcon width={17} height={17} />
            </Link>
            <span className="relative shrink-0 text-[0.875rem] font-semibold uppercase tracking-[0.16em] text-ink">
              {WORDMARK}
              <span
                className="spectral-bar absolute -bottom-[5px] left-0 h-[2px] w-full rounded-full"
                aria-hidden="true"
              />
            </span>
          </div>
          <AccountButton account={account} backend={backend} />
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-[32rem]">
          {/* Segmented control: two destinations, both always one tap away. */}
          <div
            role="tablist"
            aria-label="Pool actions"
            onKeyDown={onTabKey}
            className="mx-auto mt-2 grid w-full max-w-[18rem] grid-cols-2 gap-1 rounded-pill bg-sunk p-1.5 shadow-[inset_0_0_0_1px_rgb(13_13_15/0.06)]"
          >
            {TABS.map((t) => {
              const selected = t.id === tab;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`relative h-10 overflow-hidden rounded-pill text-[0.9375rem] font-medium tracking-[-0.01em] transition-all duration-200 ${
                    selected
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(13_13_15/0.06),0_6px_14px_-8px_rgb(13_13_15/0.3)]'
                      : 'text-ink-60 hover:text-ink'
                  }`}
                >
                  {t.label}
                  {selected ? (
                    <span
                      className="spectral-bar absolute inset-x-6 bottom-[4px] h-[2px] rounded-full"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <div role="tabpanel" id="panel-deposit" aria-labelledby="tab-deposit" hidden={tab !== 'deposit'}>
              {tab === 'deposit' ? <DepositPanel backend={backend} account={account} /> : null}
            </div>
            <div role="tabpanel" id="panel-withdraw" aria-labelledby="tab-withdraw" hidden={tab !== 'withdraw'}>
              {tab === 'withdraw' ? <WithdrawPanel backend={backend} account={account} /> : null}
            </div>
          </div>

          <div className="mt-5 flex justify-center">
            <ReadPathLine status={status} transport={transport} />
          </div>
        </div>
      </main>

      <footer className="px-4 pb-6 sm:px-6">
        <p className="mx-auto max-w-[32rem] text-center text-[0.6875rem] leading-[1.5] text-ink-45">
          Unaudited software running against {DEPLOYMENT.chainName}. Deposits and withdrawals
          are public; the link between them is what stays private.
        </p>
      </footer>
    </div>
  );
}
