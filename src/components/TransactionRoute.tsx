import { TRANSPORT } from "@/config/transport";

export function TransactionRoute() {
  return (
    <div className="space-y-1 text-xs leading-relaxed text-ink-60">
      <p>{TRANSPORT.worker.anonymizing
        ? `Browser reads and transaction submission use anonymous RPC through ${TRANSPORT.worker.label}, hiding your source IP from the destination RPC provider. Onchain addresses, amounts and transaction data remain public.`
        : "Browser reads and transaction submission use direct RPC. Your source IP is not hidden from the RPC provider."}</p>
      <p>Public proof helper requests use a separate, direct connection.</p>
      <p>Submission: EF alternative mempool · chain 1337. Staking and reputation rules permit expensive PQ verification.</p>
    </div>
  );
}
