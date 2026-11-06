'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEPLOYMENT } from '@/config/pool';
import { formatEth } from '@/lib/format';
import { CheckIcon } from '@/components/icons';

const STEP_MS = 2600;
/** The connector travelling to the next step is its own beat, not a state flip. */
const TRAVEL_MS = 750;
const HOLD_MS = 1600;

const STEPS = [
  {
    title: 'Deposit a fixed amount',
    body: `Every note in a pool is exactly ${formatEth(DEPLOYMENT.pools[1]!.denominationWei)} ETH, or one of three other sizes. Identical amounts are what make deposits indistinguishable — an unusual number would identify you on its own.`,
  },
  {
    title: 'Keep the note',
    body: 'Generated in your browser, never sent anywhere, saved once. It is a bearer secret: whoever holds it can withdraw. Lose it and the deposit is gone — there is no recovery, by design.',
  },
  {
    title: 'Withdraw somewhere else',
    body: 'Your browser proves it holds a valid, unspent note without revealing which one. The ETH arrives at an address with no public connection to the wallet that funded it.',
  },
];

/**
 * Three beats, not two: a step runs at its marker, then the connector carries
 * the sequence down to the next one. Flipping the line to full the instant a
 * step completed skipped the journey the diagram is meant to show.
 */
type Phase =
  | { kind: 'running'; index: number }
  | { kind: 'travel'; index: number }
  | { kind: 'done' };

const START: Phase = { kind: 'running', index: 0 };
const ALL_DONE: Phase = { kind: 'done' };

function next(p: Phase): Phase {
  if (p.kind === 'done') return START;
  if (p.kind === 'running') return { kind: 'travel', index: p.index };
  return p.index + 1 < STEPS.length ? { kind: 'running', index: p.index + 1 } : ALL_DONE;
}

const durationOf = (p: Phase) =>
  p.kind === 'running' ? STEP_MS : p.kind === 'travel' ? TRAVEL_MS : HOLD_MS;

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** Number, then a closing ring while it runs, then a check. */
function Marker({ index, done, active }: { index: number; done: boolean; active: boolean }) {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center">
      <span
        className={`absolute inset-0 rounded-full transition-colors duration-300 ${
          done ? 'bg-ink' : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--color-rule)]'
        }`}
      />
      {active ? (
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="17.25"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1.5}
            pathLength={1}
            strokeDasharray={1}
            className="ring-fill"
            style={{ '--fill-duration': `${STEP_MS}ms` } as React.CSSProperties}
          />
        </svg>
      ) : null}
      {done ? (
        <CheckIcon width={16} height={16} className="relative text-paper" />
      ) : (
        <span
          className={`relative font-mono text-[0.75rem] transition-colors duration-300 ${
            active ? 'text-ink' : 'text-ink-45'
          }`}
          data-numeric
        >
          {String(index + 1).padStart(2, '0')}
        </span>
      )}
    </span>
  );
}

/**
 * The three steps as a vertical stepper: marker, connector, and a ring that
 * closes while each step runs. Laid out top to bottom because that is the
 * shape people already read as a sequence — side by side, three paragraphs
 * just look like three paragraphs.
 *
 * Runs only while on screen, and under reduced motion every step simply
 * reads as complete.
 */
export function Steps() {
  const [phase, setPhase] = useState<Phase>(START);
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLOListElement>(null);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );

  // Derived, not assigned: writing this into state from an effect would be a
  // cascading render for a value that is purely a function of the media query.
  const shown = reduced ? ALL_DONE : phase;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setRunning(!!entry?.isIntersecting), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running || reduced) return;
    const timer = setTimeout(() => setPhase(next), durationOf(phase));
    return () => clearTimeout(timer);
  }, [running, reduced, phase]);

  return (
    <ol ref={ref} className="mt-10 max-w-[44rem]">
      {STEPS.map((step, i) => {
        // A marker is done once its own run finishes, which includes while
        // the line below it is still travelling.
        const done =
          shown.kind === 'done' ||
          (shown.kind === 'running' && i < shown.index) ||
          (shown.kind === 'travel' && i <= shown.index);
        const active = shown.kind === 'running' && shown.index === i;
        const travelling = shown.kind === 'travel' && shown.index === i;
        const linkFull = shown.kind === 'done' || i < shown.index;
        const last = i === STEPS.length - 1;

        return (
          <li key={step.title} className="flex gap-5">
            <div className="flex flex-col items-center">
              <Marker index={i} done={done} active={active} />
              {!last ? (
                <span className="relative w-[2px] flex-1 overflow-hidden rounded-full bg-rule">
                  {linkFull ? (
                    <span className="spectral-bar-y absolute inset-0" />
                  ) : travelling ? (
                    <span
                      key={`travel-${i}`}
                      className="spectral-bar-y fill-column absolute inset-0"
                      style={{ '--fill-duration': `${TRAVEL_MS}ms` } as React.CSSProperties}
                    />
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className={last ? 'pb-1' : 'pb-11'}>
              <h3
                className={`text-[1.125rem] font-semibold leading-tight tracking-[-0.02em] transition-colors duration-300 ${
                  done || active ? 'text-ink' : 'text-ink-60'
                }`}
              >
                {step.title}
              </h3>
              <p
                className={`mt-2 max-w-[56ch] text-[0.9375rem] leading-[1.65] transition-colors duration-300 ${
                  done || active ? 'text-ink-80' : 'text-ink-60'
                }`}
              >
                {step.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
