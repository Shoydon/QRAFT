'use client';

import { useRef, useState } from 'react';

const ROWS = 9;
const TOP = 56;
const GAP = 26;
const POOL_L = 206;
const POOL_R = 366;
const W = 572;
const H = 310;
const NOTE = 9;

/**
 * The withdrawal waits for the deposit to land. Money goes in before it comes
 * out, and animating both at once read as the withdrawal leaving first.
 */
const OUT_DELAY_MS = 230;
const MARKER_DELAY_MS = 500;

/** Resting state: one in, one out, on rows far enough apart not to pair up. */
const REST_IN = 2;
const REST_OUT = 6;

/** How far apart a pair must be before the eye stops reading them as a line. */
const MIN_GAP = 2;

type Side = 'in' | 'out';
type Hover = { side: Side; index: number; partner: number; tick: number };

/**
 * Pick a row on the opposite side: never the same row, never adjacent, and
 * never the row lit a moment ago.
 *
 * Re-rolled on every hover rather than memoised, deliberately. Hovering one
 * deposit twice gives two different withdrawals, which is the claim itself — a
 * stable mapping would imply the link exists and is merely hidden. Avoiding
 * the previous pick matters for the same reason: two deposits lighting the
 * same withdrawal reads as a shared link.
 *
 * Module scope, not component scope, because it is impure and must never be
 * reachable from render.
 */
function pickPartner(index: number, avoid: number): number {
  const far = (j: number) => Math.abs(j - index) >= MIN_GAP;
  const all = Array.from({ length: ROWS }, (_, j) => j);

  // Nine rows at a gap of two always leave several, but never trust that.
  let candidates = all.filter((j) => far(j) && j !== avoid);
  if (!candidates.length) candidates = all.filter(far);
  if (!candidates.length) candidates = all.filter((j) => j !== index);

  return candidates[Math.floor(Math.random() * candidates.length)] as number;
}

/**
 * The product in one picture: both ends of the transfer are public and the
 * middle is opaque. Nine identical notes go in, nine withdrawals come out, and
 * nothing connects any one to any other.
 */
export function PoolDiagram() {
  const [hover, setHover] = useState<Hover | null>(null);
  const rows = Array.from({ length: ROWS }, (_, i) => TOP + i * GAP);

  /**
   * The row lit last on each side, so the next pick can avoid it. Two
   * different deposits lighting the same withdrawal reads as a shared link,
   * which is the opposite of what this picture is for.
   */
  const lastLit = useRef<Record<Side, number>>({ in: REST_IN, out: REST_OUT });
  const tick = useRef(0);

  const enter = (side: Side, index: number) => {
    const partnerSide: Side = side === 'in' ? 'out' : 'in';
    const partner = pickPartner(index, lastLit.current[partnerSide]);
    lastLit.current[partnerSide] = partner;
    lastLit.current[side] = index;
    tick.current += 1;
    setHover({ side, index, partner, tick: tick.current });
  };

  const litIn = hover ? (hover.side === 'in' ? hover.index : hover.partner) : REST_IN;
  const litOut = hover ? (hover.side === 'out' ? hover.index : hover.partner) : REST_OUT;

  return (
    <figure className="m-0">
      <div className="mx-auto max-w-[36rem]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-labelledby="diagram-title diagram-desc"
          onMouseLeave={() => setHover(null)}
        >
          <title id="diagram-title">How the pool breaks the link</title>
          <desc id="diagram-desc">
            Nine identical deposits enter a pool on the left and nine withdrawals leave on the
            right. Pointing at any deposit highlights a withdrawal chosen at random, and a
            different one each time, because nothing connects a particular deposit to a particular
            withdrawal.
          </desc>

          <defs>
            {/* userSpaceOnUse, because a horizontal line has a zero-height
                bounding box and an objectBoundingBox gradient degenerates. */}
            {/* One spectrum spanning the whole figure, with the pool at its
                centre. Only the draw direction differs per side. */}
            <linearGradient
              id="spectrum-in"
              gradientUnits="userSpaceOnUse"
              x1={POOL_L}
              y1="0"
              x2={0}
              y2="0"
            >
              <stop offset="0%" stopColor="var(--color-spectral-4)" />
              <stop offset="35%" stopColor="var(--color-spectral-3)" />
              <stop offset="70%" stopColor="var(--color-spectral-2)" />
              <stop offset="100%" stopColor="var(--color-spectral-1)" />
            </linearGradient>
            <linearGradient
              id="spectrum-out"
              gradientUnits="userSpaceOnUse"
              x1={POOL_R}
              y1="0"
              x2={W}
              y2="0"
            >
              <stop offset="0%" stopColor="var(--color-spectral-4)" />
              <stop offset="35%" stopColor="var(--color-spectral-5)" />
              <stop offset="100%" stopColor="var(--color-spectral-6)" />
            </linearGradient>
          </defs>

          <text x={4} y={22} className="fill-[var(--color-ink-60)] text-[11px] font-medium">
            Deposits in
          </text>
          <text
            x={W - 4}
            y={22}
            textAnchor="end"
            className="fill-[var(--color-ink-60)] text-[11px] font-medium"
          >
            Withdrawals out
          </text>

          {rows.map((y, i) => {
            const lit = i === litIn;
            return (
              <g
                key={`in-${y}`}
                onMouseEnter={() => enter('in', i)}
                onFocus={() => enter('in', i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="button"
                aria-label={`Deposit ${i + 1} of ${ROWS}`}
                className="cursor-pointer outline-none [&:focus-visible>rect:last-child]:stroke-ink"
              >
                <rect
                  x={4}
                  y={y - NOTE / 2}
                  width={NOTE}
                  height={NOTE}
                  rx={2.5}
                  fill={lit ? 'url(#spectrum-in)' : 'var(--color-rule-strong)'}
                  className="transition-[fill] duration-200"
                />
                {/* The dim rail stays put; the lit line draws over it, so a
                    row never goes blank while it waits its turn. */}
                <line x1={18} y1={y} x2={POOL_L} y2={y} stroke="var(--color-rule)" strokeWidth={1.25} />
                {lit ? (
                  <line
                    key={`lit-${hover?.tick ?? 0}`}
                    x1={18}
                    y1={y}
                    x2={POOL_L}
                    y2={y}
                    pathLength={1}
                    stroke="url(#spectrum-in)"
                    strokeWidth={2.5}
                    className="line-draw"
                  />
                ) : null}
                {/* A 1.25px line is not a hit target; this is. */}
                <rect
                  x={0}
                  y={y - GAP / 2}
                  width={POOL_L}
                  height={GAP}
                  fill="transparent"
                  strokeWidth={1}
                  stroke="none"
                />
              </g>
            );
          })}

          {/* The pool. Opaque on purpose: this is what observers cannot see into. */}
          <rect
            x={POOL_L}
            y={34}
            width={POOL_R - POOL_L}
            height={H - 68}
            rx={26}
            fill="var(--color-ink)"
          />
          <text
            x={(POOL_L + POOL_R) / 2}
            y={H / 2 - 2}
            textAnchor="middle"
            className="fill-[var(--color-paper)] text-[17px] font-semibold"
          >
            1,284
          </text>
          <text
            x={(POOL_L + POOL_R) / 2}
            y={H / 2 + 18}
            textAnchor="middle"
            className="fill-[var(--color-rule-strong)] text-[11px]"
          >
            identical notes
          </text>

          {rows.map((y, i) => {
            const lit = i === litOut;
            return (
              <g
                key={`out-${y}`}
                onMouseEnter={() => enter('out', i)}
                onFocus={() => enter('out', i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="button"
                aria-label={`Withdrawal ${i + 1} of ${ROWS}`}
                className="cursor-pointer outline-none"
              >
                <line
                  x1={POOL_R}
                  y1={y}
                  x2={W - 18}
                  y2={y}
                  stroke="var(--color-rule)"
                  strokeWidth={1.25}
                />
                {lit ? (
                  <line
                    key={`lit-${hover?.tick ?? 0}`}
                    x1={POOL_R}
                    y1={y}
                    x2={W - 18}
                    y2={y}
                    pathLength={1}
                    stroke="url(#spectrum-out)"
                    strokeWidth={2.5}
                    className="line-draw"
                    style={{ '--draw-delay': `${OUT_DELAY_MS}ms` } as React.CSSProperties}
                  />
                ) : null}
                <rect
                  x={W - 13}
                  y={y - NOTE / 2}
                  width={NOTE}
                  height={NOTE}
                  rx={2.5}
                  fill={lit ? 'url(#spectrum-out)' : 'var(--color-rule-strong)'}
                  className="transition-[fill] duration-200"
                  style={{ transitionDelay: lit ? `${MARKER_DELAY_MS}ms` : '0ms' }}
                />
                <rect
                  x={POOL_R}
                  y={y - GAP / 2}
                  width={W - POOL_R}
                  height={GAP}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="mx-auto mt-4 sm:mt-7 max-w-[60rem]">
        <div className="mt-5 grid gap-x-10 gap-y-3 text-[0.8125rem] leading-snug text-ink-60 lg:grid-cols-3">
          <span>
            <strong className="font-medium text-ink">Deposits are public.</strong> Anyone can see
            your wallet put ETH in.
          </span>
          <span className="lg:text-center">
            <strong className="font-medium text-ink">The pool is opaque.</strong> Every note inside
            it is exactly the same size.
          </span>
          <span className="lg:text-right">
            <strong className="font-medium text-ink">Withdrawals are public.</strong> Which deposit
            paid for one is not.
          </span>
        </div>
      </figcaption>
    </figure>
  );
}
