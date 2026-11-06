import type { Hex } from "viem";

export function DeploymentReceipt({ hash }: { hash: Hex }) {
  return (
    <div className="my-4 border-t border-rule pt-4 text-xs">
      <a
        href={`https://explorer.altmempool.wtf/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View deployment transaction on EF alternative-mempool explorer"
        className="text-ink-60 underline underline-offset-4 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        explorer.altmempool.wtf ↗
      </a>
    </div>
  );
}
