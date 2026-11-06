import type { Metadata } from 'next';
import Link from 'next/link';
import { WORDMARK, TAGLINE, SHIPPED_DESCRIPTION } from '@/config/brand';
import { TRANSPORT } from '@/config/transport';
import { formatEth } from '@/lib/format';
import deployment from '../../public/pq-deployment.json';

const REPO = 'https://github.com/Shoydon/QRAFT';
const AMOUNT = formatEth(BigInt(deployment.denominationWei));

export const metadata: Metadata = {
  title: `${WORDMARK} — ${SHIPPED_DESCRIPTION}`,
  description:
    'A native ETH privacy pool with EIP-8141 frame transactions, Anon-RPC browser reads, and ML-DSA-44 wallet authorization.',
};

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-5 pt-6 sm:px-8 sm:pt-8">
        <nav aria-label="Main navigation" className="mx-auto grid max-w-[66rem] grid-cols-[1fr_auto_1fr] items-center">
          <span aria-hidden="true" />
          <Link href="/" aria-label="QRAFT home" className="relative text-lg font-semibold tracking-[0.12em] text-ink">
            {WORDMARK}
            <span className="spectral-bar absolute -bottom-1.5 left-0 h-[2px] w-full rounded-full" aria-hidden="true" />
          </Link>
          <a href={REPO} target="_blank" rel="noreferrer noopener" className="justify-self-end rounded-pill px-3 py-2 text-sm text-ink-60 transition-colors hover:bg-sunk hover:text-ink">
            Source
          </a>
        </nav>

        <div className="mx-auto max-w-[58rem] pb-12 pt-16 text-center sm:pb-16 sm:pt-24">
          <h1 className="text-balance text-[clamp(2.25rem,5.2vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-ink">
            {TAGLINE}
          </h1>
          <p className="mx-auto mt-6 max-w-[36ch] text-base leading-relaxed text-ink-60 sm:text-lg">
            Deposit {AMOUNT} native ETH. Keep your note. Withdraw to a new address.
          </p>
          <Link href="/app" className="mt-8 inline-flex h-12 items-center justify-center rounded-pill bg-ink px-8 text-sm font-medium text-paper transition-colors hover:bg-ink-80">
            Open the app
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[52rem] flex-1 px-5 sm:px-8">
        <section aria-labelledby="stack-title">
          <h2 id="stack-title" className="sr-only">Protocol and wallet stack</h2>
          <dl className="divide-y divide-rule border-y border-rule">
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">
                <a href="https://eips.ethereum.org/EIPS/eip-8141" target="_blank" rel="noreferrer noopener" className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                  EIP-8141
                </a>
              </dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                Native frame transactions, authorized by your contract account.
              </dd>
            </div>
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">
                <a href="https://ethereum.github.io/anon-rpc/" target="_blank" rel="noreferrer noopener" className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
                  Anon-RPC
                </a>
              </dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                {TRANSPORT.worker.anonymizing
                  ? `Browser reads use ${TRANSPORT.worker.label}, with no direct fallback.`
                  : 'Browser reads use a non-anonymous diagnostic worker.'}{' '}
                The local gas helper uses direct RPC.
              </dd>
            </div>
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">Post-quantum wallet stack</dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                ML-DSA-44 authorization, SHA3-512 notes, and transparent V5 proofs.
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="px-5 py-8 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-[46rem] space-y-2 text-center text-xs leading-relaxed text-ink-60">
          <p>{deployment.chainName} · Chain {deployment.chainId} · Test ETH only</p>
          <p>
            Experimental application cryptography. Chain and transport security have separate limits.
            Anonymity depends on other deposits, timing, and gas payment.
          </p>
        </div>
      </footer>
    </div>
  );
}
