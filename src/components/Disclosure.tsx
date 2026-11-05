'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronIcon } from './icons';

/**
 * Collapsed detail. The summary carries the one fact worth seeing at a glance;
 * opening it reveals the rest. Not a native <details> because the summary
 * needs a trailing value and its own focus treatment.
 */
export function Disclosure({
  label,
  summary,
  children,
}: {
  label: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="rounded-control border border-rule bg-sunk/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="text-[0.8125rem] font-medium text-ink">{label}</span>
        <span className="ml-auto truncate text-[0.8125rem] text-ink-60" data-numeric>
          {open ? null : summary}
        </span>
        <ChevronIcon
          width={16}
          height={16}
          className={`shrink-0 text-ink-60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={id} hidden={!open} className="border-t border-rule px-3.5 pb-1 pt-1">
        {children}
      </div>
    </div>
  );
}
