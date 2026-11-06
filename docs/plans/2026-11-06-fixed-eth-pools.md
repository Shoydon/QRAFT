# Fixed ETH Pools Implementation Plan

**Goal:** Offer separate 0.0001, 0.001, 0.01, and 0.1 native ETH pools, with recoverable PQ notes and sponsored gas.

**Architecture:** Preserve the current deployment and add three independently pinned pool/paymaster pairs on the active devnet. Share account and V5 verifier infrastructure. Bind each operation to its registered pool, denomination, sponsor, and deployment block; never infer the pool from an amount alone.

**Tech stack:** Next.js, TypeScript, viem, existing ML-DSA accounts, SHA3-512 note trees, transparent V5 proofs, native frame paymasters.

## Order

1. Resolve anonymous wallet connection reliability. Capture real Nym startup and RPC failures; verify creation and backup recovery against the current deployment.
2. Add a validated public pool registry. Preserve the default pool and existing note format. Route imported notes through their registered pool and reject unknown addresses or mismatched amounts.
3. Parameterize pool client, proof context, public encoder admission, and receipt validation. Bind recovered workflows and frozen transactions to their original pool.
4. Extend sponsored transaction validation to registered sponsor pins. Check each signed intent and receipt against the sponsor selected when it was signed; preserve existing pending intents.
5. Parameterize new paymaster denominations from their bound pools. Deploy three pool/sponsor pairs with a durable transaction journal, strict chain/genesis/runtime/constructor checks, and bounded disposable test-ETH funding. Register only confirmed and verified deployments.
6. Add a clean denomination selector at the amount step. Lock selection once a note or unresolved intent exists; use the note's pool on withdrawal. Display activity per selected pool and distinguish principal from sponsored gas.
7. Verify cross-pool note/proof rejection, sponsor substitution rejection, exact-value deposits, recovery, and all four amounts. Run build and browser checks. Record which checks are local, simulated, or confirmed onchain.
8. Commit coherent changes separately. Ask before pushing.

## Constraints

Only native ETH. Preserve ML-DSA authorization and the existing proof relation. Keep secrets local. Do not turn unavailable anonymous RPC into direct browser reads. Keep application PQ claims separate from chain/transport security. Do not replace the existing deployment or silently migrate notes to a different network.
