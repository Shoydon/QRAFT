# Relayerless QRAFT Implementation Plan

**Goal:** Remove backend signing/submission from user payments and public-account preparation.
**Architecture:** Browser-generated EIP-8141 transactions through Anon RPC, shared proof-authorized onchain account and restricted gas sponsor. Retain encrypted notes and local Groth16 proving.
**Tech Stack:** Solidity with pinned EIP-8141 compiler; TypeScript/viem; Next.js; Nym; Circom/Groth16.

1. Inspect deployed nonce, staking, validation rules and public provisioning. Review design for replay/sponsor risks.
2. Add shared pool preflight validation and proof-account contract; revise sponsor. Compile with pinned native compiler. Test exact shape, nonce binding, proof/nullifier checks, extra frames, value and fee restrictions.
3. Deploy fresh infrastructure with journaled native transactions; stake/fund shared contracts. Probe actual node admission before replacing frontend submission.
4. Build direct browser frame plans and persisted retries. Remove payment relay API/service; replace per-user provisioning dependency with verified browser-only flow.
5. Test real proofs, live transactions and browser flow. Run build/type/lint and verify actual Nym flow; retain honest evidence of failures.
6. Update deployment contract inventory, architecture, UI disclosures and pitch deck. Report addresses, functions and remaining limitations.
