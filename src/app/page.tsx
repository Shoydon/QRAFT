import type { Metadata } from 'next';
import Link from 'next/link';
import { WORDMARK, TAGLINE, SHIPPED_DESCRIPTION } from '@/config/brand';
import { DEPLOYMENT, TRANSPORT } from '@/config/pool';
import { PoolDiagram } from '@/components/landing/PoolDiagram';
import { Letters } from '@/components/landing/Letters';
import { Steps } from '@/components/landing/Steps';
import { ArrowRightIcon, ExternalIcon } from '@/components/icons';

const REPO = 'https://github.com/Shoydon/QRAFT';

export const metadata: Metadata = {
  title: `${WORDMARK} — ${SHIPPED_DESCRIPTION}`,
  description:
    'Deposit a fixed amount of ETH against a note you keep, then withdraw to an unrelated address. Every chain read is routed through an anonymizing network by default.',
};

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-[66rem] items-center justify-between gap-6">
          <span className="relative text-[0.875rem] font-semibold uppercase tracking-[0.16em] text-ink">
            {WORDMARK}
            <span
              className="spectral-bar absolute -bottom-[5px] left-0 h-[2px] w-full rounded-full"
              aria-hidden="true"
            />
          </span>
          <nav className="flex items-center gap-1.5">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-medium text-ink-60 transition-colors hover:bg-sunk hover:text-ink"
            >
              Source
              <ExternalIcon width={14} height={14} />
            </a>
            <Link
              href="/app"
              className="inline-flex h-10 items-center rounded-pill bg-ink px-5 text-[0.875rem] font-medium text-paper shadow-[0_1px_2px_rgb(13_13_15/0.1),0_8px_18px_-10px_rgb(13_13_15/0.5)] transition-colors hover:bg-ink-80"
            >
              Open the app
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------------------------------------------------ hero */}
        <section className="px-5 pb-14 pt-10 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-[66rem]">
            <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-ink-60">
              {TAGLINE}
            </p>
            <h1 className="mt-5 max-w-[20ch] text-[2.75rem] font-semibold leading-[0.96] tracking-[-0.05em] text-ink sm:text-[4.5rem]">
              The chain sees both ends. Never the middle.
            </h1>
            <p className="mt-6 max-w-[58ch] text-[1.0625rem] leading-[1.6] text-ink-80">
              {WORDMARK} is a fixed-denomination privacy pool. Deposit ETH against a note only you
              hold, wait, then withdraw to an address that has nothing to do with you. Both
              transactions are public. The line between them is not.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/app"
                className="inline-flex h-[3.625rem] items-center gap-2 rounded-pill bg-ink px-8 text-[1rem] font-medium text-paper shadow-[0_2px_4px_rgb(13_13_15/0.08),0_12px_28px_-12px_rgb(13_13_15/0.45)] transition-transform duration-200 hover:-translate-y-px hover:bg-ink-80"
              >
                Open the app
                <ArrowRightIcon width={18} height={18} />
              </Link>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-[3.625rem] items-center gap-2 rounded-pill bg-sunk px-7 text-[1rem] font-medium text-ink shadow-[inset_0_0_0_1px_rgb(13_13_15/0.08)] transition-colors hover:bg-rule/60"
              >
                Read the source
                <ExternalIcon width={16} height={16} />
              </a>
            </div>

            <div className="mt-16 sm:mt-20">
              <PoolDiagram />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- how it works */}
        <section className="p-5 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-[66rem]">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2.25rem]">
              Three steps, and one file that matters
            </h2>
            <Steps />
          </div>
        </section>

        {/* ------------------------------------------------------ private reads */}
        <section className="bg-sunk/70 px-5 py-16 shadow-[inset_0_1px_0_rgb(13_13_15/0.05),inset_0_-1px_0_rgb(13_13_15/0.05)] sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-[66rem] gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div>
              <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-ink-60">
                The part most privacy apps skip
              </p>
              <h2 className="mt-4 text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem]">
                Hiding you onchain is pointless if your browser hands over the rest.
              </h2>
              <p className="mt-5 text-[0.9375rem] leading-[1.65] text-ink-80">
                To show you anything, a wallet has to ask an RPC provider questions — what is this
                balance, has this note been spent. Those questions arrive with your IP address
                attached. A provider that logs them can rebuild the link the pool just went to
                such trouble to break.
              </p>
              <p className="mt-4 text-[0.9375rem] leading-[1.65] text-ink-80">
                {WORDMARK} routes every chain read through{' '}
                <a
                  href="https://ethereum.github.io/anon-rpc/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-ink underline decoration-rule-strong hover:decoration-ink"
                >
                  anon-rpc
                </a>{' '}
                by default — a hash-pinned client running in a sandboxed worker, reaching the
                network over Tor. The provider sees the question. It never sees who asked.
              </p>
            </div>

            <dl className="divide-y divide-rule/70 self-start rounded-card bg-surface p-7 shadow-card">
              {[
                ['Anonymizing network', TRANSPORT.worker.label],
                ['Client integrity', 'keccak256-pinned, on-chain'],
                ['Default state', 'On. Not a setting to find.'],
                ['If it cannot start', 'Reads stop. No silent fallback.'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-6 py-3 first:pt-0 last:pb-0">
                  <dt className="text-[0.8125rem] text-ink-60">{k}</dt>
                  <dd className="text-right text-[0.8125rem] font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* -------------------------------------------------------------- name */}
        <section className="p-5 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-[66rem]">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2.25rem]">
              Where the name is going
            </h2>
            <p className="mt-4 max-w-[62ch] text-[0.9375rem] leading-[1.65] text-ink-80">
              {WORDMARK} stands for three things.
            </p>
            <div className="mt-10">
              <Letters />
            </div>
          </div>
        </section>
      </main>

      <footer className="px-5 py-12 sm:px-8">
        <div className="mx-auto flex max-w-[66rem] flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
          <p className="max-w-[60ch] text-[0.75rem] leading-[1.6] text-ink-60">
            Running against the {DEPLOYMENT.chainName.toLowerCase()}. Deposits and withdrawals
            are public; the link between them is what stays private.
          </p>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-ink-60 transition-colors hover:text-ink"
          >
            MIT licensed
            <ExternalIcon width={13} height={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
