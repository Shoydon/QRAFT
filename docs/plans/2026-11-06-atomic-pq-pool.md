# Atomic PQ wallet and privacy pool Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy and verify a simplified chain-1337 application with one account per wallet and one atomic sponsored withdrawal, then build and push main.

**Architecture:** Fixed shared wallet verifier, proof verifier, paymaster, pool and factory; public-key verification data travels in authorization calldata instead of separate contracts. Prefer a demonstrably practical PQ proof; use the approved conventional fallback if investigated candidates cannot satisfy the complete circuit, contract and gas requirements. No per-proof deployments or session orchestrator in the new default path.

**Tech Stack:** Solidity/solc, EIP-8141 and ERC-8421 sidecar, ML-DSA-44/@noble, viem, Next.js/React, Anon-RPC/Nym, browser-local proving, Bun/Playwright and live devnet receipts.

---

Execution context: preserve the existing dirty tree and historical signed journals. Use a new `packages/atomic` boundary for replacement code; stage explicit files rather than committing unrelated work. Prior UI, header interoperability and frame-envelope fixes are available for reuse. Do not restart the superseded verifier job.

### Task 1: Feasibility and measured baseline

Files: create `docs/pq/atomic-feasibility.md`; inspect `docs/pq/pq-v5-security-argument.md`, `protocol/circuits/spend.circom`, `protocol/contracts/SpendVerifier.sol`, and existing live receipts.

1. Count actual code-storage uploads and aggregate confirmed old receipts by role/phase; record partial versus historical complete measurements explicitly.
2. Check primary sources for established direct PQ/EVM verifier candidates and compact zkVM verification paths. Reject a SNARK wrapper as evidence of end-to-end PQ security.
3. Inspect the existing conventional circuit's public-input binding, setup provenance, license and browser prover. Identify required expiry/context changes.
4. Record the selected proof profile and reason. No parameter reduction or new cryptographic construction without a defensible security argument.
5. Record a reproducible full-proof gas and calldata benchmark before selecting the production candidate. If PQ candidates lack a usable complete path, execute the approved conventional fallback with explicit security labels.

### Task 2: One shared ML-DSA verifier, one account per wallet

Files: create `scripts/build-atomic-verifier.mjs`, `packages/atomic/contracts/AtomicAccount.sol`, `packages/atomic/contracts/AtomicFactory.sol`, `packages/atomic/src/wallet.ts`, `scripts/test-atomic-verifier.mjs` and `tests/atomic-wallet.test.ts`.

1. Adapt pinned ML-DSA source in memory to `verify(bytes preparedKey, bytes message, bytes signature) returns(bool)` using bounded calldata copies instead of deployed-key pointers. Preserve provenance and arithmetic; strip profiling only.
2. Replace the separately deployed unrolled Keccak helper with a compact inlined FIPS-202 permutation if runtime/gas permit. Differential-test SHAKE and complete ML-DSA verification against the existing implementation and noble. Do not accept a changed helper without these tests.
3. Implement account immutables for verifier and canonical prepared-key commitment. Bind exact native `sig_hash`, reject other signature schemes/counts, check public-data commitment/format, and expose only protocol-authorized execution. No validator module, descriptor, rows or clone implementation.
4. Factory creation binds salt, verifier and commitment; deploy one account and return its address. Keep required staking behavior restricted to funding the account's own stake.
5. Test wrong public data/key/message, malformed signature, unauthorized execution and replay/nonce context. Verify deployed runtime size and total frame gas.
6. Run `bun test tests/atomic-wallet.test.ts` and `node scripts/test-atomic-verifier.mjs`; expected real valid signatures accepted and all mutation cases rejected.

### Task 3: Atomic pool and one paymaster

Files: create `packages/atomic/contracts/AtomicPool.sol`, `packages/atomic/contracts/AtomicPaymaster.sol`, `scripts/build-atomic.mjs`, `scripts/test-atomic-protocol.mjs`; adapt the selected verifier/circuit with provenance.

1. Define the exact public statement: root, nullifier, recipient, chain, pool, asset/denomination, fixed fee policy and expiry. Derive the digest in the pool and constrain every public signal in the circuit.
2. Implement deposit plus `withdraw(proof, publicInputs)` with known-root, denomination, expiry and spent-nullifier checks. Call the shared verifier and pay atomically; use reentrancy protection.
3. Include tree hashing in a fixed contract boundary instead of another deployed helper where possible; measure runtime size rather than assuming it fits.
4. Paymaster validates the exact allowed three-frame structure, factory/account provenance, signature verification target, pool action/value, fee and gas ceilings before approving sponsorship. No arbitrary sponsored call.
5. Generate a real proof and execute local deposit/withdraw tests. Mutate recipient/context/nullifier/root/proof, replay, and force payout failure; assert no funds/state changes for failed withdrawals.
6. Run `node scripts/build-atomic.mjs` and `node scripts/test-atomic-protocol.mjs`; save actual receipt gas and runtime sizes. Require a full transaction below sidecar cap with margin.

### Task 4: Client and recovery

Files: create `src/lib/atomic/account.ts`, `src/lib/atomic/pool.ts`, `src/lib/atomic/proof.ts`, `src/lib/atomic/note.ts`, `src/lib/atomic/service.ts`, `tests/atomic-account.test.ts`; reuse `packages/frame-account/src/frametx.ts`, `src/lib/pq/vault.ts` and wallet collection infrastructure through versioned adapters.

1. Encode exactly three frames: account VERIFY, paymaster VERIFY, account SENDER call to pool. Include committed public-key data with the signature and bind all signed fields.
2. Create a versioned note/deployment format; reject historical notes from the new pool instead of reinterpreting them.
3. Generate and verify the selected proof locally. No witness, proof-upload job, session or public-data deployment service.
4. Journal exact signed bytes before submission; require canonical successful receipts/events. Retry only the same intent after uncertain delivery, with bounded cancellation-aware sidecar retry.
5. Keep Nym routing for reads/submission and verified header serialization. Retain user-initiated passkey unlock and named multiple wallets.
6. Test amount, context and paymaster binding plus uncertain/failed receipts and stale deployment rejection with `bun test tests/atomic-account.test.ts`.

### Task 5: Deploy fixed stack and two wallets

Files: create `scripts/deploy-atomic.ts`, `public/atomic-deployment.json`, `scripts/test-atomic-live.ts` and public evidence under `docs/pq/atomic-*`.

1. Verify live chain/genesis, sidecar limits, staking rules and available gas funding. Reuse protected local operator file; never print or commit its key.
2. Deploy fixed shared contracts with deterministic journaled native transactions; register/fund/stake sponsor. Verify code/configuration against local artifacts.
3. Generate two local test keypairs and deploy exactly two account contracts through the sidecar. Store secrets only in ignored 0600 files.
4. Confirm fixed deployed inventory, account creation gas, and each receipt. Count all helper contracts honestly; revisit the design boundary if implementation requires an extra deployment.
5. Deposit from A and withdraw to B with B as submitter; require actual sidecar inclusion, exact payout and spent-note rejection. Capture three frame receipts, payer and gas. Do not claim success from simulation/admission alone.

### Task 6: UI integration

Files: create `src/components/AtomicApp.tsx`; modify `src/app/app/page.tsx`, relevant wallet components and `src/config/transport.ts`; read installed Next.js docs first.

1. Reuse the established visual style and wallet interactions. Route the new app to the explicit new manifest/profile.
2. Show only local proof generation, transaction submission, and confirmation. Remove upload/session orchestration from the default flow.
3. Show actual frames, gas sponsor and explorer link; keep copy icons and concise connected-wallet status. Permit pasted notes and EOA recipients.
4. Label the proof's real security scope and remove stale all-PQ claims if fallback selected.
5. Verify accessible focus, small screens, reconnect/retry and wallet selection in browser; preserve unrelated landing/design changes.

### Task 7: Real browser lifecycle and security checks

Files: create `scripts/test-atomic-app.mjs`, public test evidence and receipt image.

1. Create/import two disposable wallets with virtual passkey coverage; reload must not trigger unsolicited unlock.
2. Generate note, sponsored deposit, local proof, and one atomic withdrawal through actual Nym and the sidecar.
3. Check recipient/pool balance deltas, nullifier spent state, all frame outcomes, payer, and explorer receipt.
4. Count deployed contracts before/after withdrawal: zero new contracts. Assert no private seed/witness in HTTP requests and no direct user RPC submission fallback.
5. Exercise invalid proof, recipient/context mutation, replay, failed payout, cancellation and receipt reconciliation as appropriate; no fake proof or security bypass for the successful path.
6. Record consumed versus reserved gas, calldata bytes, browser proving time and exact security scope. Keep historical evidence clearly separate.

### Task 8: Finish and publish

Files: update `README.md`, `docs/pq/ef-track.md`, `docs/pq/application-security.md`, approved design status and implementation evidence.

1. Remove stale default-path references to per-proof deployments, sessions, old gas payer, and incorrect PQ proof claims. Keep recovery documentation for historical notes.
2. Run `npm test`, relevant local protocol/browser checks, and `npm run check`. Expected all pass, with live evidence for new architecture.
3. Inspect diff for secrets, unrelated changes and forbidden project references. Stage explicit files and commit descriptive changes.
4. Fetch origin main, compare divergence, preserve/integrate others' changes, rerun checks if integration changes code, then plain `git push origin main` as already authorized.
5. Report deployed addresses, deposit/withdraw explorer links, contract count, gas measurements, proof security scope and commit hash. Do not mark incomplete live work as complete.
