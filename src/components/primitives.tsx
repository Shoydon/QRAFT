'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertIcon, CheckIcon, ClockIcon, InfoIcon, QuestionIcon, Spinner } from './icons';

/* ------------------------------------------------------------------ button -- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-ink text-paper shadow-[0_1px_2px_-1px_rgb(13_13_15/0.3)] hover:bg-ink-80 disabled:bg-surface disabled:text-ink-60 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-rule',
  secondary:
    'bg-sunk text-ink shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)] hover:bg-rule/60 disabled:text-ink-60',
  ghost: 'text-ink-80 hover:text-ink hover:bg-sunk disabled:text-ink-60',
  danger: 'bg-surface text-state-bad border border-state-bad/35 hover:bg-state-bad/6',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon,
  iconAfter,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  icon?: ReactNode;
  iconAfter?: ReactNode;
}) {
  const pad =
    size === 'lg'
      ? 'h-[3.625rem] px-7 text-[1rem]'
      : size === 'sm'
        ? 'h-8 px-3 text-[0.8125rem]'
        : 'h-11 px-4.5 text-sm';
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-pill font-medium tracking-[-0.01em] transition-colors duration-[120ms] disabled:cursor-not-allowed ${pad} ${VARIANT[variant]} ${className}`}
    >
      {busy ? <Spinner /> : icon}
      <span className="truncate">{children}</span>
      {!busy && iconAfter}
    </button>
  );
}

/* ------------------------------------------------------------------- card --- */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'aside' | 'form';
}) {
  return (
    <Tag
      className={`rounded-card bg-surface shadow-card ${className}`}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ state --- */

export type Tone = 'neutral' | 'pending' | 'good' | 'spent' | 'unknown' | 'bad';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-state-neutral',
  pending: 'text-state-pending',
  good: 'text-state-good',
  spent: 'text-state-spent',
  unknown: 'text-state-unknown',
  bad: 'text-state-bad',
};

const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-state-neutral',
  pending: 'bg-state-pending',
  good: 'bg-state-good',
  spent: 'bg-state-spent',
  unknown: 'bg-state-unknown',
  bad: 'bg-state-bad',
};

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block size-[7px] shrink-0 rounded-full ${TONE_BG[tone]}`}
      style={pulse ? { animation: 'pulse-dot 1.4s ease-in-out infinite' } : undefined}
    />
  );
}

export function StatusLine({
  tone,
  children,
  pulse,
  className = '',
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[0.8125rem] font-medium ${TONE_TEXT[tone]} ${className}`}
    >
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function ToneIcon({ tone, size = 18 }: { tone: Tone; size?: number }) {
  const cls = TONE_TEXT[tone];
  if (tone === 'good') return <CheckIcon className={cls} width={size} height={size} />;
  if (tone === 'bad') return <AlertIcon className={cls} width={size} height={size} />;
  if (tone === 'unknown') return <QuestionIcon className={cls} width={size} height={size} />;
  if (tone === 'neutral') return <InfoIcon className={cls} width={size} height={size} />;
  return <ClockIcon className={cls} width={size} height={size} />;
}

/**
 * Inline notice. The border carries the tone at 1px — never a thick colored
 * rule, never a nested card.
 */
export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const ring: Record<Tone, string> = {
    neutral: 'border-rule bg-sunk',
    pending: 'border-state-pending/30 bg-state-pending/[0.05]',
    good: 'border-state-good/30 bg-state-good/[0.05]',
    spent: 'border-state-spent/30 bg-state-spent/[0.05]',
    unknown: 'border-state-unknown/30 bg-state-unknown/[0.05]',
    bad: 'border-state-bad/30 bg-state-bad/[0.05]',
  };
  return (
    <div className={`rounded-control border p-3.5 ${ring[tone]}`} role="status">
      <div className="flex gap-3">
        <span className="mt-px shrink-0">
          <ToneIcon tone={tone} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[0.8125rem] font-semibold ${TONE_TEXT[tone]}`}>{title}</p>
          {children ? (
            <div className="mt-1 text-[0.8125rem] leading-[1.5] text-ink-80">{children}</div>
          ) : null}
          {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hero --- */

/**
 * The amount, as the subject of the screen. Everything else on a step is
 * support for this number, so it gets the size and the optical centring.
 */
export function Hero({
  value,
  unit,
  caption,
  tone = 'neutral',
}: {
  value: string;
  unit?: string;
  caption?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="py-1 text-center">
      {/* Sans, not mono: the mono face's dotted zero reads as code at this
          size, and a headline amount is read as a whole, not compared digit
          by digit the way a hash is. */}
      <p
        className="text-[4rem] font-semibold leading-[0.98] tracking-[-0.05em] text-ink"
        data-numeric
      >
        {value}
        {unit ? (
          <span className="ml-2.5 align-baseline text-[1.5rem] font-medium tracking-[-0.02em] text-ink-45">
            {unit}
          </span>
        ) : null}
      </p>
      {caption ? (
        <p className={`mt-2.5 text-[0.8125rem] leading-snug ${TONE_TEXT[tone]}`}>{caption}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- data rows --- */

export function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[0.8125rem] text-ink-60">{label}</dt>
      <dd className="min-w-0 text-right">
        <div className="truncate text-[0.8125rem] font-medium text-ink" data-numeric>
          {children}
        </div>
        {hint ? <div className="mt-0.5 text-[0.75rem] leading-snug text-ink-60">{hint}</div> : null}
      </dd>
    </div>
  );
}

export function RowGroup({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-rule">{children}</dl>;
}

/* --------------------------------------------------------------- the rail --- */

/** Determinate or indeterminate progress. The spectral gradient travels; hues never change. */
export function Rail({
  fraction,
  label,
}: {
  fraction: number | null;
  label: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      className="h-[3px] w-full overflow-hidden rounded-full bg-rule"
    >
      {fraction === null ? (
        <div className="spectral-rail h-full w-full" />
      ) : (
        <div
          className="spectral-bar h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(2, fraction * 100))}%` }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ label --- */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-60">
      {children}
    </span>
  );
}

export function Mono({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`font-mono text-[0.8125rem] tracking-[-0.01em] ${className}`} data-numeric>
      {children}
    </span>
  );
}
