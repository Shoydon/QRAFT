"use client";

import { useState } from "react";
import type { Hex } from "viem";

export function DeploymentReceipt({ hash }: { hash: Hex }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="my-4 border-t border-rule pt-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="text-ink-60">Deployment transaction</span>
        <button type="button" className="underline underline-offset-4" onClick={() => {
          void navigator.clipboard.writeText(hash).then(() => { setCopied(true); setFailed(false); }, () => setFailed(true));
        }}>{copied ? "Copied" : "Copy hash"}</button>
      </div>
      <code className="block break-all text-xs leading-relaxed">{hash}</code>
      {failed ? <p role="status" className="mt-2 text-xs text-ink-60">Select the hash above to copy it.</p> : null}
    </div>
  );
}
