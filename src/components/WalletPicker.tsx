"use client";

import { Button } from "./primitives";
import { truncateMiddle } from "@/lib/format";

interface WalletChoice { id: string; name: string; address: string | null; selected: boolean; connected: boolean }

export function WalletPicker({ wallets, busy, canCreate, select, rename, create }: {
  wallets: WalletChoice[]; busy: boolean; canCreate: boolean;
  select(id: string): void; rename(id: string, name: string): void; create(): void;
}) {
  return (
    <div className="mb-5 space-y-3 border-b border-rule pb-5">
      <p className="text-sm font-medium">{wallets.length} {wallets.length === 1 ? "wallet" : "wallets"} found</p>
      {wallets.length ? <ul className="space-y-2" aria-label="Saved wallets">
        {wallets.map((wallet, index) => (
          <li key={wallet.id} className={`flex items-center gap-3 rounded-control p-3 ${wallet.selected ? "bg-sunk" : "bg-sunk/40"}`}>
            <div className="min-w-0 flex-1">
              <input key={`${wallet.id}:${wallet.name}`} aria-label={`Wallet ${index + 1} name`} defaultValue={wallet.name}
                maxLength={48} disabled={busy} autoComplete="off" className="wallet-name-input w-full rounded bg-transparent px-1 py-0.5 text-sm font-medium"
                onBlur={event => rename(wallet.id, event.currentTarget.value)}
                onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              <p className="mt-1 text-xs text-ink-60">{wallet.address ? truncateMiddle(wallet.address, 10, 6) : "Setup not finished"}</p>
            </div>
            {wallet.connected || wallet.selected ? <span className="shrink-0 text-xs text-ink-60">{wallet.connected ? "Connected" : "Selected"}</span> : <button type="button" disabled={busy} onClick={() => select(wallet.id)}
              className="shrink-0 text-xs text-ink-60 underline-offset-4 hover:underline"
              aria-label={`Select ${wallet.name}`}>
              Select
            </button>}
          </li>
        ))}
      </ul> : null}
      {wallets.length ? <>
        <Button className="w-full" disabled={busy || !canCreate} onClick={create}>Create another wallet</Button>
      </> : null}
    </div>
  );
}
