const ROWS = 9;
const TOP = 56;
const GAP = 26;
const POOL_L = 206;
const POOL_R = 366;
const W = 572;
const H = 310;

/** The one deposit and the one withdrawal drawn in spectrum. Deliberately on
 *  different rows: the picture must not let the eye pair them up. */
const LIT_IN = 2;
const LIT_OUT = 6;

const NOTE = 9;

/**
 * The product in one picture: both ends of the transfer are public and the
 * middle is opaque. Nine identical notes go in, nine withdrawals come out, and
 * nothing visible connects any one to any other — which is the guarantee, and
 * also exactly its limit.
 */
export function PoolDiagram() {
  const rows = Array.from({ length: ROWS }, (_, i) => TOP + i * GAP);

  return (
    <figure className="m-0">
      <div className="mx-auto max-w-[36rem]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-labelledby="diagram-title diagram-desc"
        >
          <title id="diagram-title">How the pool breaks the link</title>
          <desc id="diagram-desc">
            Nine identical deposits enter a pool on the left and nine withdrawals leave on the
            right. One deposit and one withdrawal are highlighted on different rows, because
            nothing visible connects any deposit to any particular withdrawal.
          </desc>

          <defs>
            {/* userSpaceOnUse, because a horizontal line has a zero-height
                bounding box and an objectBoundingBox gradient degenerates. */}
            <linearGradient id="spectrum" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
              <stop offset="0%" stopColor="var(--color-spectral-1)" />
              <stop offset="20%" stopColor="var(--color-spectral-2)" />
              <stop offset="40%" stopColor="var(--color-spectral-3)" />
              <stop offset="60%" stopColor="var(--color-spectral-4)" />
              <stop offset="80%" stopColor="var(--color-spectral-5)" />
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
            const lit = i === LIT_IN;
            return (
              <g key={`in-${y}`}>
                <rect
                  x={4}
                  y={y - NOTE / 2}
                  width={NOTE}
                  height={NOTE}
                  rx={2}
                  fill={lit ? 'url(#spectrum)' : 'var(--color-rule-strong)'}
                />
                <line
                  x1={18}
                  y1={y}
                  x2={POOL_L}
                  y2={y}
                  stroke={lit ? 'url(#spectrum)' : 'var(--color-rule)'}
                  strokeWidth={lit ? 2.5 : 1.25}
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
            rx={18}
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
            const lit = i === LIT_OUT;
            return (
              <g key={`out-${y}`}>
                <line
                  x1={POOL_R}
                  y1={y}
                  x2={W - 18}
                  y2={y}
                  stroke={lit ? 'url(#spectrum)' : 'var(--color-rule)'}
                  strokeWidth={lit ? 2.5 : 1.25}
                />
                <rect
                  x={W - 13}
                  y={y - NOTE / 2}
                  width={NOTE}
                  height={NOTE}
                  rx={2}
                  fill={lit ? 'url(#spectrum)' : 'var(--color-rule-strong)'}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="mx-auto mt-7 grid max-w-[60rem] gap-x-10 gap-y-3 text-[0.8125rem] leading-snug text-ink-60 lg:grid-cols-3">
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
      </figcaption>
    </figure>
  );
}
