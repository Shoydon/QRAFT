import { TRANSPORT } from "@/config/transport";

export function TransactionRoute() {
  return (
    <div className="space-y-1 text-xs leading-relaxed text-ink-60">
      <p>{TRANSPORT.worker.anonymizing
        ? `Browser reads and transaction submission use anonymous RPC through ${TRANSPORT.worker.label}, hiding your source IP from the destination RPC provider. Onchain addresses, amounts and transaction data remain public.`
        : "Browser reads and transaction submission use direct RPC. Your source IP is not hidden from the RPC provider."}</p>
      <p>Proof and authorization helper requests use a separate, direct connection.</p>
      <p>Submission: Ethrex native mempool. EF alternative mempool is not enabled.</p>
    </div>
  );
}
