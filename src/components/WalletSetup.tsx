"use client";

import { Sheet } from "./Sheet";
import { Button, Notice } from "./primitives";
import { CheckIcon, Spinner } from "./icons";
import type { Hex } from "viem";
import { DeploymentReceipt } from "./DeploymentReceipt";

const steps = [
  ["Generating PQ keypair", 1, 2],
  ["Publishing public key", 2, 7],
  ["Deploying smart account", 7, 9],
  ["Checking deployment", 9, 11],
] as const;

export const WALLET_SETUP_STEPS = 11;

export function walletSetupStep(label: string): number | null {
  const row = /^Deploying public key row ([1-4]) of 4$/.exec(label);
  if (row) return Number(row[1]) + 1;
  if (label === "Generating your signing key locally") return 1;
  if (label === "Deploying the public key descriptor") return 6;
  if (label === "Deploying your smart account") return 7;
  if (label === "Funding the devnet deposit balance" || label === "Staking your smart account for the alternative mempool") return 8;
  if (label === "Verifying your deployed smart account") return 9;
  return null;
}

export function WalletSetup({ open, step, progress, error, deploymentHash, onClose }: {
  open: boolean; step: number; progress: string; error: string | null; deploymentHash?: Hex | null; onClose(): void;
}) {
  const complete = step === WALLET_SETUP_STEPS;
  const row = /^Deploying public key row ([1-4]) of 4$/.exec(progress);
  const publicKeyDetail = row
    ? `${Number(row[1]) - 1} of 4 data contracts confirmed. Deploying the next part…`
    : step === 6 ? "4 of 4 data contracts confirmed. Linking them to your account…" : null;
  return (
    <Sheet open={open} onClose={onClose} title={complete ? "Your wallet is ready" : "Set up your PQ wallet"}>
      <ol aria-label="Wallet setup steps" className="divide-y divide-rule">
        {steps.map(([title, start, end], index) => {
          const done = step >= end;
          const active = step >= start && step < end;
          const state = done ? "Complete" : active ? error ? "Stopped" : "In progress" : "Waiting";
          return (
            <li key={title} aria-current={active ? "step" : undefined} className={`flex gap-3 py-3 transition-opacity ${!done && !active ? "opacity-35" : "opacity-100"}`}>
              <span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${done ? "border-[var(--state-good)] text-[var(--state-good)]" : active ? "border-current" : "border-rule"}`}>
                {done ? <CheckIcon width={16} height={16} /> : active && error ? "!" : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium">{title}</p>
                  <span className="text-[0.6875rem] text-ink-60">
                    {active && !error ? <span role="status" aria-label={`${title} in progress`}><Spinner /></span> : state}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {deploymentHash ? <DeploymentReceipt hash={deploymentHash} /> : null}
      {error || !complete && publicKeyDetail ? <div className="mt-4" role="status" aria-live="polite">
        {error ? <Notice tone="bad" title="Wallet setup stopped">{error} Close this view and resume wallet setup to retry the same wallet.</Notice>
          : <p className="text-xs leading-relaxed text-ink-60">{publicKeyDetail}</p>}
      </div> : null}
      {error ? <Button className="mt-5 w-full" onClick={onClose}>
        Back to wallet
      </Button> : null}
    </Sheet>
  );
}
