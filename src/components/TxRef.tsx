'use client';

import { useState } from 'react';
import { DEPLOYMENT } from '@/config/pool';
import { explorerTxUrl, truncateMiddle } from '@/lib/format';
import { CopyIcon, CheckIcon, ExternalIcon } from './icons';

/**
 * The single place a transaction reference is rendered. Simulated references
 * are stamped and never linked, so a simulated receipt cannot read as real
 * chain activity.
 */
export function TxRef({ hash, simulated }: { hash: string; simulated: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = simulated ? null : explorerTxUrl(DEPLOYMENT.explorerBase, hash);

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      {simulated ? (
        <span className="shrink-0 rounded-[5px] border border-state-pending/40 bg-state-pending/[0.07] px-1.5 py-px font-mono text-[0.625rem] font-medium uppercase tracking-[0.08em] text-state-pending">
          simulated
        </span>
      ) : null}
      <span className="truncate font-mono text-[0.8125rem] text-ink" data-numeric>
        {truncateMiddle(hash, 10, 8)}
      </span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded p-0.5 text-ink-60 transition-colors hover:text-ink"
        aria-label={copied ? 'Reference copied' : 'Copy reference'}
      >
        {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
      </button>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 rounded p-0.5 text-ink-60 transition-colors hover:text-ink"
          aria-label="View on block explorer"
        >
          <ExternalIcon width={14} height={14} />
        </a>
      ) : null}
    </span>
  );
}

export function TxRefHint({ simulated }: { simulated: boolean }) {
  if (!simulated) return null;
  return (
    <>No transaction exists on {DEPLOYMENT.chainName}. This reference is local to this session.</>
  );
}
