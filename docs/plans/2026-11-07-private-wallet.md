# Qraft Private Wallet Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved ETH-first private wallet, with automatic note management, receiving encryption, change and local proving on a fresh devnet pool.

**Architecture:** New bounded join/split pool and circuit; deterministic browser wallet keys and encrypted recovery; reconstructable encrypted-output discovery; independent relay for private actions; existing PQ modular account tooling for native frames. Written design: `docs/superpowers/specs/2026-11-07-private-wallet-design.md`.

**Tech Stack:** TypeScript, Next.js 16.4.5, React, Circom/Groth16, Solidity, viem, noble ML-KEM/ML-DSA, WebCrypto, native frame devnet.

User approved implementation in this session. Preserve unrelated dirty files; stage only task-owned paths. No migration work. Review architecture before cryptographic implementation. Reconcile all deviations in the spec.

## Task 1: Keys, receiving descriptors and encrypted notes

Files: `src/lib/private-wallet/crypto.ts`, `model.ts`, `tests/private-wallet.test.ts`.
1. Test deterministic independent key derivation, descriptor checksum/domain rejection and owner-bound note commitments.
2. Implement master-secret branches, ML-KEM-768 + HKDF/AES-GCM envelopes and strict fixed-format parsing.
3. Test wrong decryption key, ciphertext/associated-data tampering, malformed payloads and commitment mismatch.
4. Implement password-encrypted portable recovery; test wrong password and exact key restoration.
5. Run `bun test tests/private-wallet.test.ts`; expected all cases pass without secrets in output.

## Task 2: Circuit and pool

Files: `packages/private-pool/circuits/join-split.circom`, `contracts/PrivatePool.sol`, build artifacts, `scripts/build-private-pool.mjs`, `scripts/test-private-pool.mjs`.
1. Pin compiler/tool dependencies and reproduce circuit build plus development-only setup with documented provenance.
2. Implement four inputs/two outputs, ownership, tree membership, nullifiers, range constraints, conservation and context binding.
3. Implement pool validation, ciphertext publication, append tree and atomic public payout.
4. Test real local proofs for deposit/send/change/merge/withdraw; reject mutation, inflation, ownership and replay attacks.
5. Measure proving time and verification gas. If performance requires shape changes, update design explicitly.

## Task 3: Wallet engine

Files: `src/lib/private-wallet/tree.ts`, `planner.ts`, `discovery.ts`, `vault.ts`, `engine.ts`, prover worker, tests.
1. Test exact bigint accounting and note selection, reservation, consolidation and insufficient funds.
2. Implement chain event reconstruction and local encrypted-output discovery with consistent snapshots.
3. Implement proof input/output validation, local proof verification and pinned artifacts.
4. Implement passkey vault, recovery restore and encrypted journals; test stale/unknown/conflicting spends.
5. Verify clean-browser recovery and offline recipient discovery using real pool events.

## Task 4: Native deployment and submission

Files: private pool deployment manifest, `src/lib/private-wallet/service.ts`, new API route handlers, sponsor contract, deploy/live-test scripts.
1. Read installed Next route-handler/server-boundary docs before adding routes.
2. Reuse pinned native compiler and frame tooling; deploy new verifier/pool/sponsor and independent PQ carrier.
3. Implement bounded/idempotent proof relay with durable signed journals, no recipient secrets and no caller identity required.
4. Validate receipts, exact events and sidecar admission. Record transport privacy boundaries truthfully.
5. Exercise three-wallet flow and invalid-proof/sponsorship cases on devnet if infrastructure/funding permits.

## Task 5: User experience

Files: `src/components/PrivateWalletApp.tsx`, app route, scoped styles, wallet worker wiring.
1. Read installed Next client-boundary docs and DESIGN.md.
2. Build wallet onboarding, single balance, Add/Send/Receive/Withdraw and activity details.
3. Hide cryptographic internals by default; expose honest live stages, pending balance, backup verification and consolidation review.
4. Ensure keyboard/mobile layout, reduced motion, actionable errors and no success before canonical receipt.
5. Browser test genuine flows; never use simulated success as deployment evidence.

## Task 6: Verification and handoff

1. Run focused cryptographic/protocol tests, then `npm run typecheck`, `npm run lint`, `npm run build`.
2. Run browser lifecycle tests, inspect screenshots and resolve errors.
3. Reconcile security scope and operational instructions in product docs; report actual deployment status and limitations.
4. Commit only task-owned changes, without publishing or altering unrelated work.

## Progress

- Architecture finalized; independent builder review completed and findings resolved.
- Tasks 1–4 implemented: deterministic keys, encrypted receiving/recovery, real circuit and pool, discovery/proof workers, durable intents, native deployment, sponsorship and shared relay.
- Task 5 core flows implemented and browser-tested; exact V1 UI limits are recorded in design section 15.
- Verification: 89 unit tests, typecheck, lint and production build pass. Real local adversarial proof tests and live native shield/send/withdraw pass. Production browser E2E with real provisioning/relay/sidecar passes, including offline recovery and a dropped response. Separate real-Nym app startup and balance sync pass.
- Additional full-Nym integration attempt confirmed both deposits and the private payment, then stalled on reload reconciliation. It was stopped after roughly 15 minutes; full Nym recovery/withdrawal remains unverified. See `docs/pq/private-wallet-e2e-nym-attempt.json`. Timed-out reads now reconnect before retrying; submissions are not automatically retried by this wrapper.
