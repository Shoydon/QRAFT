import type { Metadata } from 'next';
import Link from 'next/link';
import { WORDMARK, TAGLINE, SHIPPED_DESCRIPTION } from '@/config/brand';
import { DEPLOYMENT, TRANSPORT } from '@/config/pool';
import { formatEth } from '@/lib/format';
import { PoolDiagram } from '@/components/landing/PoolDiagram';
import { Letters } from '@/components/landing/Letters';
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
              className="inline-flex h-9 items-center rounded-pill bg-ink px-4 text-[0.8125rem] font-medium text-paper transition-colors hover:bg-ink-80"
            >
              Open the app
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------------------------------------------------ hero */}
        <section className="px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-16">
          <div className="mx-auto max-w-[66rem]">
            <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-ink-60">
              {TAGLINE}
            </p>
            <h1 className="mt-5 max-w-[20ch] text-[2.5rem] font-semibold leading-[0.98] tracking-[-0.045em] text-ink sm:text-[4rem]">
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
                className="inline-flex h-14 items-center gap-2 rounded-pill bg-ink px-7 text-[0.9375rem] font-medium text-paper shadow-[0_1px_2px_-1px_rgb(13_13_15/0.3)] transition-colors hover:bg-ink-80"
              >
                Open the app
                <ArrowRightIcon width={18} height={18} />
              </Link>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-14 items-center gap-2 rounded-pill border border-rule-strong bg-surface px-6 text-[0.9375rem] font-medium text-ink transition-colors hover:border-ink"
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
        <section className="border-t border-rule px-5 py-14 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-[66rem]">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2.25rem]">
              Three steps, and one file that matters
            </h2>
            <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
              {[
                {
                  n: '01',
                  t: 'Deposit a fixed amount',
                  d: `Every note in a pool is exactly ${formatEth(DEPLOYMENT.pools[1]!.denominationWei)} ETH, or one of three other sizes. Identical amounts are what make deposits indistinguishable — an unusual number would identify you on its own.`,
                },
                {
                  n: '02',
                  t: 'Keep the note',
                  d: 'Generated in your browser, never sent anywhere, downloaded once. It is a bearer secret: whoever holds it can withdraw. Lose it and the deposit is gone — there is no recovery, by design.',
                },
                {
                  n: '03',
                  t: 'Withdraw somewhere else',
                  d: 'Your browser proves it holds a valid, unspent note without revealing which one. The ETH arrives at an address with no public connection to the wallet that funded it.',
                },
              ].map((s) => (
                <li key={s.n}>
                  <span className="font-mono text-[0.75rem] text-ink-45" data-numeric>
                    {s.n}
                  </span>
                  <span className="spectral-bar mt-2 block h-[2px] w-9 rounded-full" />
                  <h3 className="mt-4 text-[1.0625rem] font-semibold tracking-[-0.02em]">{s.t}</h3>
                  <p className="mt-2 text-[0.875rem] leading-[1.6] text-ink-80">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------ private reads */}
        <section className="border-t border-rule bg-sunk/50 px-5 py-14 sm:px-8 sm:py-20">
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

            <dl className="divide-y divide-rule self-start rounded-card border border-rule bg-surface p-6 shadow-card">
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

        {/* ------------------------------------------------------------- honesty */}
        <section className="border-t border-rule px-5 py-14 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-[66rem]">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2.25rem]">
              What we don&rsquo;t claim
            </h2>
            <p className="mt-4 max-w-[62ch] text-[0.9375rem] leading-[1.65] text-ink-80">
              Privacy tools attract absolute language. Here is the honest version, which is also
              the version the interface tells you while you use it.
            </p>
            <ul className="mt-9 grid gap-x-12 gap-y-7 sm:grid-cols-2">
              {[
                [
                  'Not guaranteed anonymity',
                  'You hide among the other unspent notes of the same size. A busy pool hides you well; an empty one does not hide you at all. The app shows the number so you can judge it.',
                ],
                [
                  'Not quantum-proof',
                  'The Q in the name is where this is going, not where it is. Today the commitments and proofs are classical, and nothing in the app says otherwise.',
                ],
                [
                  'Not able to save you from yourself',
                  'Withdraw to the wallet you deposited from, or seconds after depositing, and you have drawn the link yourself. The app warns at each of those moments.',
                ],
                [
                  'Not audited, and not finished',
                  'This is hackathon software. The pool contract is not deployed yet, so chain activity in this build is simulated and labelled as such on every receipt.',
                ],
              ].map(([t, d]) => (
                <li key={t}>
                  <h3 className="text-[1rem] font-semibold tracking-[-0.015em]">{t}</h3>
                  <p className="mt-1.5 text-[0.875rem] leading-[1.6] text-ink-80">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* -------------------------------------------------------------- name */}
        <section className="border-t border-rule px-5 py-14 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-[66rem]">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2.25rem]">
              Where the name is going
            </h2>
            <p className="mt-4 max-w-[62ch] text-[0.9375rem] leading-[1.65] text-ink-80">
              {WORDMARK} stands for three things. One of them is built.
            </p>
            <div className="mt-10">
              <Letters />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-[66rem] flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
          <p className="max-w-[60ch] text-[0.75rem] leading-[1.6] text-ink-60">
            Unaudited software built for a hackathon on the{' '}
            {DEPLOYMENT.chainName.toLowerCase()}. Deposits and withdrawals are public; the link
            between them is what stays private, and only as much as the pool&rsquo;s other unspent
            notes allow. Do not put money you care about through it.
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
