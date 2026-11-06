import type { Metadata } from "next";
import Link from "next/link";
import { WORDMARK, TAGLINE, SHIPPED_DESCRIPTION } from "@/config/brand";
import { TRANSPORT } from "@/config/transport";
import { formatEth } from "@/lib/format";
import deployment from "../../public/pq-deployment.json";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { GitHubIcon } from "@/components/icons";

const REPO = "https://github.com/Shoydon/QRAFT";
const AMOUNT = formatEth(BigInt(deployment.denominationWei));

const STEPS = [
  {
    title: 'Deposit',
    body: `You send exactly ${AMOUNT} ETH. Everyone sends the same amount, so no single deposit stands out.`,
  },
  {
    title: 'Keep the note',
    body: 'Your browser makes a secret and never sends it anywhere. It is the only thing that can claim the deposit back.',
  },
  {
    title: 'Withdraw',
    body: 'Your device proves the secret is real without showing which deposit it belongs to. The ETH arrives at a fresh address.',
  },
] as const;

export const metadata: Metadata = {
  title: `${WORDMARK} — ${SHIPPED_DESCRIPTION}`,
  description:
    "A native ETH privacy pool with EIP-8141 frame transactions, Anon-RPC browser reads, and ML-DSA-44 wallet authorization.",
};

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 pt-6 sm:px-10 sm:pt-8 lg:px-16">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex w-full max-w-[80rem] items-center justify-between"
        >
          <Link
            href="/"
            aria-label="QRAFT home"
            className="relative text-lg font-semibold tracking-[0.12em] text-ink"
          >
            {WORDMARK}
            <span
              className="spectral-bar absolute -bottom-1.5 left-0 h-[2px] w-full rounded-full"
              aria-hidden="true"
            />
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="QRAFT on GitHub"
            className="inline-flex size-11 items-center justify-center rounded-pill text-ink-60 transition-colors hover:bg-sunk hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            <GitHubIcon width={22} height={22} />
          </a>
        </nav>

        <div className="mx-auto max-w-[58rem] pb-12 pt-16 text-center sm:pb-16 sm:pt-24">
          <h1 className="text-balance text-[clamp(2.25rem,5.2vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-ink">
            {TAGLINE}
          </h1>
          <p className="mx-auto mt-6 max-w-[36ch] text-base leading-relaxed text-ink-60 sm:text-lg">
            Deposit {AMOUNT} native ETH. Keep your note. Withdraw to a new
            address.
          </p>
          <Link
            href="/app"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-pill bg-ink px-8 text-sm font-medium text-paper transition-colors hover:bg-ink-80"
          >
            Open the app
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[52rem] flex-1 px-5 sm:px-8">
        <section aria-labelledby="stack-title" className="pb-14 sm:pb-20">
          <h2 id="stack-title" className="sr-only">
            Protocol and wallet stack
          </h2>
          <dl className="divide-y divide-rule border-y border-rule">
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">
                <a
                  href="https://eips.ethereum.org/EIPS/eip-8141"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
                >
                  EIP-8141
                </a>
              </dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                Native frame transactions, authorized by your contract account.
              </dd>
            </div>
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">
                <a
                  href="https://ethereum.github.io/anon-rpc/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
                >
                  Anon-RPC
                </a>
              </dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                {TRANSPORT.worker.anonymizing
                  ? `Browser reads use ${TRANSPORT.worker.label}, with no direct fallback.`
                  : "Browser reads use a non-anonymous diagnostic worker."}{" "}
                The local gas helper uses direct RPC.
              </dd>
            </div>
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">
                Post-quantum wallet stack
              </dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                ML-DSA-44 authorization, SHA3-512 notes, and transparent V5
                proofs.
              </dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="how-title" className="pb-20">
          <h2
            id="how-title"
            className="text-xl font-semibold tracking-[-0.02em] text-ink sm:text-2xl"
          >
            How it works
          </h2>
          <HowItWorks steps={STEPS} />
          <p className="mt-10 max-w-[56ch] text-sm leading-relaxed text-ink-60">
            Both transactions are visible on the chain. What stays hidden is
            which deposit paid for which withdrawal, and that holds only while
            other deposits of the same size are sitting unspent alongside yours.
          </p>
        </section>
      </main>
    </div>
  );
}
