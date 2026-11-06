"use client";

import type { ReactNode } from "react";
import type { WithdrawalPhase } from "@/lib/pq/progress";
import { Sheet } from "./Sheet";
import { Button } from "./primitives";
import { CheckIcon } from "./icons";

const steps: readonly [WithdrawalPhase, string][] = [
  ["checking-note", "Checking note"],
  ["proving", "Generating zero-knowledge proof in your browser"],
  ["checking-proof", "Checking proof locally"],
  ["publishing", "Publishing public proof"],
  ["verifying", "Verifying proof onchain"],
  ["submitting", "Submitting withdrawal"],
];

export function WithdrawalProgress({ open, phase, complete, progress, error, transaction, onClose, onCancel }: {
  open: boolean; phase: WithdrawalPhase; complete: boolean; progress: string; error: string | null;
  transaction?: ReactNode; onClose(): void; onCancel?: () => void;
}) {
  const current = complete ? steps.length : steps.findIndex(([id]) => id === phase);
  return <Sheet open={open} onClose={onClose} title={complete ? "Withdrawal confirmed" : "Withdrawal progress"}>
    <p className="mb-4 text-xs text-ink-60">Transparent V5 · Goldilocks5 · SHA3-512 · hash/FRI</p>
    <ol aria-label="Withdrawal steps" className="divide-y divide-rule">
      {steps.map(([id, title], index) => {
        const done = index < current, active = index === current;
        return <li key={id} aria-current={active ? "step" : undefined}
          className={`flex items-start gap-3 py-3 transition-opacity ${!done && !active ? "opacity-35" : "opacity-100"}`}>
          <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">
            {done ? <CheckIcon width={16} height={16} /> : active && error ? "!" : index + 1}
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
          <span className="shrink-0 pt-0.5 text-[0.6875rem] text-ink-60">{done ? "Complete" : active ? error ? "Paused" : "In progress" : "Waiting"}</span>
        </li>;
      })}
    </ol>
    {transaction ? <div className="mt-4 text-xs">{transaction}</div> : null}
    {!complete && (error || !['checking-note', 'proving', 'checking-proof'].includes(phase)) ? <p role="status" aria-live="polite" className="mt-4 text-xs leading-relaxed text-ink-60">{error ?? progress}</p> : null}
    <Button className="mt-5 w-full" onClick={onClose}>{complete ? "Done" : error ? "Back to withdrawal" : "Continue in background"}</Button>
    {onCancel ? <Button className="mt-2 w-full" variant="ghost" onClick={onCancel}>Cancel proof preparation</Button> : null}
  </Sheet>;
}
