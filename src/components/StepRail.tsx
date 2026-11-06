'use client';

/** Compact step indicator. Hairline rules; the current step carries the spectrum. */
export function StepRail({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className={`h-[2px] w-full rounded-full ${
                active ? 'spectral-bar' : done ? 'bg-ink' : 'bg-rule'
              }`}
            />
            <span
              className={`truncate text-[0.6875rem] font-medium tracking-[0.02em] ${
                active ? 'text-ink' : done ? 'text-ink-60' : 'text-ink-45'
              }`}
              aria-current={active ? 'step' : undefined}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
