"use client";

import { Sheet } from "./Sheet";
import { Button, Notice } from "./primitives";
import { CheckIcon } from "./icons";

const steps = [
  ["Generate your keys locally", "Your private signing key stays on this device.", 1, 2],
  ["Publish your public key", "Prepare the public data used to verify your signatures.", 2, 7],
  ["Deploy your smart account", "Create your wallet contract and add test ETH.", 7, 9],
  ["Verify your wallet", "Check that the deployed account belongs to your public key.", 9, 10],
  ["Save your protected wallet", "Encrypt the wallet locally with your passkey.", 10, 11],
] as const;

export const WALLET_SETUP_STEPS = 11;

export function walletSetupStep(label: string): number | null {
  const row = /^Deploying public key row ([1-4]) of 4$/.exec(label);
  if (row) return Number(row[1]) + 1;
  if (label === "Generating your signing key locally") return 1;
  if (label === "Deploying the public key descriptor") return 6;
  if (label === "Deploying your smart account") return 7;
  if (label === "Funding the devnet deposit balance") return 8;
  if (label === "Verifying your deployed smart account") return 9;
  return null;
}

export function WalletSetup({ open, step, progress, error, onClose }: {
  open: boolean; step: number; progress: string; error: string | null; onClose(): void;
}) {
  const complete = step === WALLET_SETUP_STEPS;
  const row = /^Deploying public key row ([1-4]) of 4$/.exec(progress);
  const publicKeyDetail = row
    ? `${Number(row[1]) - 1} of 4 data contracts confirmed. Deploying the next part…`
    : step === 6 ? "4 of 4 data contracts confirmed. Linking them to your account…" : null;
  const visibleProgress = complete ? "Your smart account is verified. Continue to save your encrypted backup."
    : step === 0 ? "Preparing wallet setup…"
    : step >= 2 && step <= 6 ? publicKeyDetail ?? "Publishing your public key…"
    : progress;
  return (
    <Sheet open={open} onClose={onClose} title={complete ? "Your wallet is ready" : "Set up your PQ wallet"}>
      <p className="mb-5 text-sm leading-relaxed text-ink-60">
        Your keys are created on this device. Setup then deploys public-key data
        and a smart account on the devnet. Only your public key is sent to the deployment helper.
      </p>
      <ol aria-label="Wallet setup steps" className="divide-y divide-rule">
        {steps.map(([title, detail, start, end], index) => {
          const done = step >= end;
          const active = step >= start && step < end;
          const state = done ? "Complete" : active ? error ? "Stopped" : "In progress" : "Waiting";
          return (
            <li key={title} aria-current={active ? "step" : undefined} className={`flex gap-3 py-3 ${!done && !active ? "text-ink-60" : ""}`}>
              <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${done ? "border-[var(--state-good)] text-[var(--state-good)]" : active ? "border-current" : "border-rule"}`}>
                {done ? <CheckIcon width={16} height={16} /> : active && error ? "!" : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium">{title}</p>
                  <span className="text-[0.6875rem] text-ink-60">{state}</span>
                </div>
                {active || done && index === 0 ? <p className="mt-1 text-xs leading-relaxed text-ink-60">{detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4" role="status" aria-live="polite">
        {error ? <Notice tone="bad" title="Wallet setup stopped">{error} Close this view and resume wallet setup to retry the same wallet.</Notice>
          : <p className="text-xs leading-relaxed text-ink-60">{visibleProgress}</p>}
      </div>
      <Button className="mt-5 w-full" onClick={onClose}>
        {complete ? "Continue to wallet" : error ? "Back to wallet" : "Continue in background"}
      </Button>
    </Sheet>
  );
}
