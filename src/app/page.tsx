import type { Metadata } from "next";
import Link from "next/link";
import { WORDMARK, TAGLINE, SHIPPED_DESCRIPTION } from "@/config/brand";
import { TRANSPORT } from "@/config/transport";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { GitHubIcon } from "@/components/icons";
import { Brand } from "@/components/Logo";

const REPO = "https://github.com/Shoydon/QRAFT";

const STEPS = [
  {
    title: 'Add ETH',
    body: 'Move ETH into your ERC-8286 PQ wallet. Incoming payments automatically become one balance.',
  },
  {
    title: 'Send an exact amount',
    body: 'Your device selects the funds and proves the payment locally. Any change stays in your ERC-8286 PQ wallet.',
  },
  {
    title: 'Receive payments',
    body: 'Share your private receiving address to receive payments. Restore your encrypted backup with your original passkey.',
  },
] as const;

export const metadata: Metadata = {
  title: `${WORDMARK} — ${SHIPPED_DESCRIPTION}`,
  description:
    "One private ETH balance, exact payments, encrypted receiving and local proofs with sponsored gas.",
};

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 pt-6 sm:px-10 sm:pt-8 lg:px-16">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex w-full max-w-[80rem] items-center justify-between"
        >
          <Link href="/" aria-label="QRAFT home">
            <Brand />
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
            Deposit ETH, send and receive private payments, and manage everything in one balance.
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
            Protocol and ERC-8286 PQ wallet
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
                Private payments use an HTTPS relay that can see IP and timing.
              </dd>
            </div>
            <div className="grid gap-2 py-6 sm:grid-cols-[12rem_1fr] sm:gap-8 sm:py-7">
              <dt className="text-sm font-medium text-ink">
                Keys and private proofs
              </dt>
              <dd className="max-w-[46ch] text-sm leading-relaxed text-ink-60">
                ML-DSA-44 authorization and ML-KEM encrypted delivery.
                Local Groth16 proofs use conventional cryptography; the payment
                system is not end-to-end post-quantum.
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
            Deposits and withdrawals expose their public addresses and amounts.
            Private sends keep their amounts inside encrypted payments, but
            timing and network metadata can still allow correlation. This is an
            experimental ERC-8286 PQ wallet with a development proof setup.
          </p>
        </section>
      </main>
    </div>
  );
}
