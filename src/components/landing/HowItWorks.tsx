'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const STEP_MS = 2400;
/** The connector reaching the next step is its own beat, not a state flip. */
const TRAVEL_MS = 650;
const HOLD_MS = 1600;

type Step = { title: string; body: string };

type Phase =
  | { kind: 'running'; index: number }
  | { kind: 'travel'; index: number }
  | { kind: 'done' };

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * The three steps as a horizontal sequence: a ring closes around each number
 * while that step runs, then the connector carries the colour rightward to
 * the next one. Runs only while on screen, and under reduced motion every
 * step simply reads as complete.
 */
export function HowItWorks({ steps }: { steps: readonly Step[] }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'running', index: 0 });
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLOListElement>(null);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
  // Derived, not assigned: writing it into state from an effect would be a
  // cascading render for a value that is purely a function of the query.
  const shown: Phase = reduced ? { kind: 'done' } : phase;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setRunning(!!entry?.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running || reduced) return;
    const ms =
      phase.kind === 'running' ? STEP_MS : phase.kind === 'travel' ? TRAVEL_MS : HOLD_MS;
    const timer = setTimeout(() => {
      setPhase((p) => {
        if (p.kind === 'done') return { kind: 'running', index: 0 };
        if (p.kind === 'running') return { kind: 'travel', index: p.index };
        return p.index + 1 < steps.length
          ? { kind: 'running', index: p.index + 1 }
          : { kind: 'done' };
      });
    }, ms);
    return () => clearTimeout(timer);
  }, [running, reduced, phase, steps.length]);

  return (
    <ol ref={ref} className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-10">
      {steps.map((step, i) => {
        // A number is done once its own run finishes, which includes while
        // the connector after it is still travelling.
        const done =
          shown.kind === 'done' ||
          (shown.kind === 'running' && i < shown.index) ||
          (shown.kind === 'travel' && i <= shown.index);
        const active = shown.kind === 'running' && shown.index === i;
        const travelling = shown.kind === 'travel' && shown.index === i;
        const linkFull = shown.kind === 'done' || i < shown.index;

        return (
          <li key={step.title} className="relative flex gap-4 sm:block">
            <span className="relative flex size-8 shrink-0 items-center justify-center">
              <span
                className={`absolute inset-0 rounded-full transition-colors duration-300 ${
                  done ? 'bg-ink' : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--color-rule)]'
                }`}
              />
              {active ? (
                <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
                  <circle
                    cx="16"
                    cy="16"
                    r="15.25"
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
              <span
                className={`relative text-xs font-medium transition-colors duration-300 ${
                  done ? 'text-paper' : active ? 'text-ink' : 'text-ink-45'
                }`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
            </span>

            {/* Two connectors, because the axis changes with the layout.
                Stacked, it runs down from this number to the next and has to
                clear the grid gap; in three columns it runs across it. */}
            {i < steps.length - 1 ? (
              <>
                <span className="absolute -bottom-8 left-[15px] top-9 w-[2px] overflow-hidden rounded-full bg-rule sm:hidden">
                  {linkFull ? (
                    <span className="spectral-bar-y absolute inset-0" />
                  ) : travelling ? (
                    <span
                      key={`travel-y-${i}`}
                      className="spectral-bar-y fill-column absolute inset-0"
                      style={{ '--fill-duration': `${TRAVEL_MS}ms` } as React.CSSProperties}
                    />
                  ) : null}
                </span>
                <span className="absolute left-10 top-[15px] hidden h-[2px] overflow-hidden rounded-full bg-rule sm:-right-10 sm:block">
                  {linkFull ? (
                    <span className="spectral-bar absolute inset-0" />
                  ) : travelling ? (
                    <span
                      key={`travel-x-${i}`}
                      className="spectral-bar fill-row absolute inset-0"
                      style={{ '--fill-duration': `${TRAVEL_MS}ms` } as React.CSSProperties}
                    />
                  ) : null}
                </span>
              </>
            ) : null}

            <div className="min-w-0 pb-2 sm:pb-0 sm:mt-4">
              <h3
                className={`text-sm font-medium transition-colors duration-300 ${
                  done || active ? 'text-ink' : 'text-ink-60'
                }`}
              >
                {step.title}
              </h3>
              <p
                className={`mt-2 max-w-[34ch] text-sm leading-relaxed transition-colors duration-300 ${
                  done || active ? 'text-ink-60' : 'text-ink-45'
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
