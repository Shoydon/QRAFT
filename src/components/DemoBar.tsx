'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEPLOYMENT } from '@/config/pool';
import {
  SCENARIOS,
  getScenario,
  setScenario,
  subscribeScenario,
  type ScenarioId,
} from '@/lib/adapters/scenario';
import { ChevronIcon, SlidersIcon } from './icons';

/**
 * Demo mode banner. Persistent, because every chain-facing result below it is
 * simulated and a judge must never have to remember that.
 *
 * The scenario picker lives here rather than in the deposit or withdraw flow:
 * it is a diagnostic, and diagnostics stay out of the main journey.
 */
export function DemoBar() {
  const scenario = useSyncExternalStore(subscribeScenario, getScenario, () => 'happy' as ScenarioId);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const active = SCENARIOS.find((s) => s.id === scenario);
  const groups = [...new Set(SCENARIOS.map((s) => s.group))];

  return (
    <div className="relative z-30 border-b border-state-pending/25 bg-state-pending/[0.06]">
      <div className="mx-auto flex max-w-[62rem] flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <span className="flex shrink-0 items-center gap-2 text-[0.75rem] font-semibold text-state-pending">
          <span className="inline-block size-[7px] rounded-full bg-state-pending" />
          Demo mode
        </span>
        <p className="min-w-0 flex-1 text-balance text-[0.75rem] leading-snug text-ink-80">
          No pool contract is deployed and no proving artifacts are bundled, so deposits,
          proofs, withdrawals and note lookups are simulated and labelled. Notes and their
          cryptography are real. {DEPLOYMENT.chainName} is named for the note binding only.
        </p>
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-control border border-state-pending/35 bg-surface px-2.5 py-1 text-[0.75rem] font-medium text-ink transition-colors hover:border-state-pending sm:self-auto"
        >
          <SlidersIcon width={14} height={14} />
          <span>{scenario === 'happy' ? 'Scenarios' : active?.label}</span>
          <ChevronIcon
            width={14}
            height={14}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open ? (
        <div
          ref={panel}
          className="absolute right-4 top-[calc(100%-2px)] z-40 w-[19rem] rounded-card border border-rule bg-surface p-3 shadow-lift sm:right-6"
        >
          <p className="px-1 pb-2 text-[0.75rem] leading-snug text-ink-60">
            Force a simulated condition, then run the flow that reaches it.
          </p>
          <div className="max-h-[22rem] overflow-y-auto">
            {groups.map((group) => (
              <div key={group} className="pt-1.5">
                <p className="px-1 pb-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink-45">
                  {group}
                </p>
                {SCENARIOS.filter((s) => s.group === group).map((s) => {
                  const selected = s.id === scenario;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setScenario(s.id);
                        setOpen(false);
                        trigger.current?.focus();
                      }}
                      aria-pressed={selected}
                      className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[0.8125rem] transition-colors ${
                        selected ? 'bg-ink text-paper' : 'text-ink-80 hover:bg-sunk hover:text-ink'
                      }`}
                    >
                      <span
                        className={`inline-block size-[6px] shrink-0 rounded-full ${
                          selected ? 'bg-paper' : 'bg-rule-strong'
                        }`}
                      />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
