# Private wallet release review — 2026-11-07

This is a focused source review and executable verification, not an independent security audit or a guarantee that no vulnerabilities exist.

## Checked boundaries

- The join/split circuit constrains input ownership, Merkle membership, 128-bit amounts and value conservation. Four input amounts plus the deposit cannot wrap the BN254 scalar field. Output owners and randomness must be nonzero for active outputs.
- The pool rejects repeated nullifiers, duplicate outputs, unknown roots, invalid operation/value combinations, expired actions and invalid proofs. Domain, recipient, public amounts, outputs and encrypted envelopes are bound to the public action digest. Withdrawal failure reverts nullifiers and tree changes atomically.
- Application payments require successful type-6 EIP-8141 receipts, expected frames/sponsor, exact settlement identity, canonical block and a subsequent block. Unknown transaction outcomes retain the saved intent. Retry uses the saved signed payment, not a new payment.
- Backup exports contain an AES-GCM encrypted master secret and public passkey metadata. Import requires the original PRF-capable credential; the password-recovery path has been removed. The five-minute recovery quarantine remains.
- Faucet funding accepts only a public address, checks the upstream network genesis, distinguishes submission from confirmation and uses the provider's limits. The provided faucet's transfer is type 2, not EIP-8141.

## Material limitations

- Groth16/BN254 and the note circuit are conventional cryptography. Parameters come from a single-operator development setup, not a production ceremony. PQ signing and receiving encryption do not make the entire protocol post-quantum.
- Private sends and withdrawals reach the shared relay over HTTPS; it can observe IP and timing. Nym is used for browser chain reads and deposit submissions. Full uninterrupted Nym payment E2E remains unverified.
- Sponsorship is finite and lacks production admission quotas. Valid repeated activity and adversarial attempts can exhaust service capacity or sponsorship. The relay uses single-host local journals and locks; it is not safe to deploy as independent stateless replicas.
- Chain reads rely on the configured RPC and canonicality checks, not a locally verified consensus light client. Discovery scans full history and the tree has finite capacity.
- A passkey-protected backup cannot recover a lost passkey. Cross-device concurrent spending is not revoked by restoring; the contract prevents double spending, but another device can still create competing intents.
- Ciphertext validity is checked by the receiving wallet; an intentional sender can create an undecryptable output and lose its own payment. Onchain proof acceptance does not prove recipient delivery.

## Verification evidence

- `private-pool-local.json`: real Groth16 shield/join/send/withdraw, altered public signals/calldata, invalid witnesses, replay rejection and atomic failed payout.
- `private-wallet-browser.json`: real browser passkey backup/restore, cross-tab lock, proof generation, timeout reconnect, balance loading and mobile layout.
- `private-wallet-faucet.json`: real provider funding receipt, recipient/value and public balance.
- `private-wallet-e2e.json`: full UI-to-chain test with injected test reads and real provisioning, relay, local proofs and native sidecar transactions. Check its event list for the tested recovery version.

No new fund-loss defect was identified in this review. The limitations above remain release conditions; this code is a hackathon prototype, not approved for production funds.

Release checks completed: production build, typecheck, lint, 90 tests, local real-proof adversarial flow and the updated live UI E2E all passed. The E2E includes two deposits, multi-note send, dropped relay response and reload reconciliation, original-passkey restore after clearing storage, the actual recovery quarantine, and exact partial withdrawal/remaining balance. Browser chain reads in that E2E are explicitly injected direct test reads, not a claim of full-Nym reliability.
