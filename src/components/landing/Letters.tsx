'use client';

import { useState } from 'react';

/**
 * The acronym, spelled out. Each part names its real words; the letters that
 * form QRAFT are the ones set in ink, so the name reads out of the phrase
 * rather than being pasted in front of it.
 *
 * Collapsed to just the name, with the detail on hover or focus. The section
 * heading already frames all three as direction, so per-card status badges
 * only repeated it louder.
 */
const PARTS = [
  {
    key: 'qr',
    words: [
      { lead: 'Q', tail: 'uantum' },
      { lead: 'R', tail: 'esistant' },
    ],
    join: '-',
    body: 'Post-quantum account access, kept deliberately separate from note ownership, so that losing one cannot lose the other.',
  },
  {
    key: 'a',
    words: [{ lead: 'A', tail: 'nonymous' }],
    join: '',
    body: 'The pool itself, plus private reads. Deposits and withdrawals are unlinkable onchain, and every chain read the app makes is routed through an anonymizing network by default.',
  },
  {
    key: 'ft',
    words: [
      { lead: 'F', tail: 'rame' },
      { lead: 'T', tail: 'ransactions' },
    ],
    join: ' ',
    body: 'EIP-8141, through the alternative mempool. The pool pays for a withdrawal itself, so a fresh recipient address never needs ETH of its own — the last place a user can accidentally link the two halves.',
  },
];

type Part = (typeof PARTS)[number];

function Name({ part }: { part: Part }) {
  return (
    <span className="flex flex-wrap items-baseline text-[1.5rem] leading-tight tracking-[-0.03em]">
      {part.words.map((w, i) => (
        <span key={w.lead}>
          {i > 0 && part.join ? <span className="font-normal text-ink-45">{part.join}</span> : null}
          <span className="font-semibold text-ink">{w.lead}</span>
          <span className="text-[1.0625rem] font-normal text-ink-60">{w.tail}</span>
        </span>
      ))}
    </span>
  );
}

export function Letters() {
  /**
   * One card open at a time.
   *
   * Hover opens on a mouse and closes on leave; tapping toggles. The two are
   * kept apart by pointerType rather than by CSS, because `focus-within` could
   * not tell a click from a keyboard focus and left cards stuck open, while
   * `focus-visible` alone left touch users with no way in at all.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <ol className="grid items-start gap-3 sm:grid-cols-3">
      {PARTS.map((p) => {
        const open = openKey === p.key;

        return (
          <li key={p.key} className="relative">
            {/*
              Multi-column only. There, a card has to overlay rather than grow,
              or opening one would shove the other two headings off the shared
              baseline — so this spacer holds the collapsed height and the card
              floats above it. Stacked on a phone there is no shared baseline
              to protect, and overlaying would simply bury the next card, so
              the spacer is dropped and the card sits in normal flow.
            */}
            <div className="invisible hidden p-7 sm:block" aria-hidden="true">
              <Name part={p} />
            </div>

            <div
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') setOpenKey(p.key);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setOpenKey(null);
              }}
              className={`relative overflow-hidden rounded-card bg-surface p-7 transition-shadow duration-300 ease-[var(--ease-out-expo)] sm:absolute sm:inset-x-0 sm:top-0 ${
                open ? 'z-20 shadow-lift' : 'shadow-card'
              }`}
            >
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenKey((k) => (k === p.key ? null : p.key))}
                  className="flex w-full items-start justify-between gap-4 text-left"
                >
                  <Name part={p} />
                  {/* Rotates to an × when open: enough to say the card toggles. */}
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 shrink-0 text-[1rem] leading-none text-ink-45 transition-transform duration-300 ${
                      open ? 'rotate-45' : ''
                    }`}
                  >
                    +
                  </span>
                </button>
              </h3>

              {/* 0fr to 1fr animates height without measuring anything. */}
              <div
                className={`grid transition-[grid-template-rows] duration-400 ease-[var(--ease-out-expo)] ${
                  open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <p
                    className={`pt-4 text-[0.875rem] leading-[1.65] text-ink-80 transition-opacity duration-300 ${
                      open ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    {p.body}
                  </p>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
