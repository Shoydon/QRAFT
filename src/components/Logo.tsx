import type { SVGProps } from 'react';
import { WORDMARK } from '@/config/brand';

/**
 * The QRAFT mark: twelve identical notes ringing a Q sealed with the spectral
 * hairline. The ring is the anonymity set — every note in a pool is the same
 * amount, so they are drawn the same and no one of them is distinguished.
 *
 * This is the master geometry for the mark. The favicon (src/app/icon.svg)
 * is a separate cut for small sizes, not this one scaled down, and
 * src/app/apple-icon.png is rasterized from this same geometry.
 *
 * Ink is currentColor so the mark inherits its surrounding text colour. The
 * seal keeps its literal spectral stops: it is the one place in the mark where
 * DESIGN.md's rainbow hairline applies, and it does not restate state.
 *
 * Below about 32px the note ring closes into a band — use src/app/icon.svg's
 * geometry there instead.
 *
 * The gradient id is a module constant rather than useId, so the mark can be
 * rendered from a server component. Two instances on a page therefore share
 * one id; the definitions are identical, so both resolve to the same gradient.
 */
const SEAL_GRADIENT_ID = 'qraft-logo-seal';

export function Logo({ size = 32, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="QRAFT"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient id={SEAL_GRADIENT_ID} gradientUnits="userSpaceOnUse" x1="17" y1="17" x2="47" y2="47">
          <stop offset="0" stopColor="#d64545" />
          <stop offset="0.2" stopColor="#e08a3c" />
          <stop offset="0.4" stopColor="#c9a93a" />
          <stop offset="0.6" stopColor="#43935f" />
          <stop offset="0.8" stopColor="#3a76c4" />
          <stop offset="1" stopColor="#7a51c0" />
        </linearGradient>
      </defs>
      <g fill="currentColor">
        <circle cx="54" cy="32" r="3.2" />
        <circle cx="51.05" cy="21" r="3.2" />
        <circle cx="43" cy="12.95" r="3.2" />
        <circle cx="32" cy="10" r="3.2" />
        <circle cx="21" cy="12.95" r="3.2" />
        <circle cx="12.95" cy="21" r="3.2" />
        <circle cx="10" cy="32" r="3.2" />
        <circle cx="12.95" cy="43" r="3.2" />
        <circle cx="21" cy="51.05" r="3.2" />
        <circle cx="32" cy="54" r="3.2" />
        <circle cx="43" cy="51.05" r="3.2" />
        <circle cx="51.05" cy="43" r="3.2" />
      </g>
      <g fill="none" strokeLinecap="round">
        <path d="M44.8 34.26A13 13 0 1 0 34.26 44.8" stroke={`url(#${SEAL_GRADIENT_ID})`} strokeWidth="2.5" />
        <path d="M39.4 39.4 53.2 53.2" stroke="currentColor" strokeWidth="3.5" />
      </g>
    </svg>
  );
}

/**
 * The header lockup: mark then wordmark, defined once so `/` and `/app` cannot
 * drift apart in mark size, tracking or gap — they already had.
 *
 * The mark is aria-hidden because the wordmark beside it already carries the
 * name; announcing it twice helps nobody. Callers supply the link and its
 * accessible name.
 */
export function Brand() {
  return (
    <span className="flex items-center gap-2.5 text-lg font-semibold tracking-[0.12em] text-ink">
      <Logo size={28} aria-hidden="true" />
      {WORDMARK}
    </span>
  );
}
