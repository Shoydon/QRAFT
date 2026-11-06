# EF alternative mempool implementation plan

> **For Codex:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Run QRAFT wallet creation, deposits and withdrawals on EF's chain 1337 with real sidecar submission and observable admission/inclusion, retaining anonymous browser RPC.

**Architecture:** Replace the demo deployment rather than maintain multiple networks, as requested. Pin chain 1337 and its genesis, use the sidecar's nine-field frame envelope and JSON submission API. Do not reinterpret old notes or relabel direct execution as sidecar admission.

**Tech Stack:** TypeScript/viem, native EIP-8141 Solidity, existing ML-DSA-44 verifier, Nym Anon-RPC, EF gateway sidecar.

## 1. Establish wire compatibility
- Extend `packages/frame-account/src/frametx.ts` with an explicit nine-field codec for chain 1337, including empty recent roots; preserve old decoding only for test fixtures.
- Add a strict JSON wire adapter in `packages/frame-account/src/alt-mempool.ts`.
- Test canonical serialization, signature binding, root envelope and chain mismatch rejection.
- Create an isolated disposable operator key and obtain faucet funds. Submit a native frame through `eth_sendFrameTransaction`, save public status and inclusion evidence.

## 2. Deploy compatible infrastructure
- Remove hardcoded 8141 restrictions from new paymaster builds in favor of immutable deployment chain identity.
- Determine staking needs from actual sidecar admission errors; add owner-only staking forwarding to entities where required, without changing custody authorization.
- Deploy public cryptographic primitives, account implementation, factory, proof verifier, pool and paymaster on 1337 with journaled native transactions. Pin actual code hashes and constructor bindings.
- Only switch `public/pq-deployment.json` after checking the new infrastructure. Replace pool registry with new-chain pools.

## 3. Route app and helpers through the sidecar
- Use gateway reads through Nym and `eth_sendFrameTransaction` for user and helper writes. Preserve frozen-intent retry semantics; no direct-broadcast fallback.
- Validate returned hashes and final payer/frame receipts. Surface admission failure accurately.
- Point explorer links to the matching sidecar explorer; display actual route.
- New network-scoped wallet storage prevents treating old encrypted accounts as new-chain accounts; no legacy recovery UI required.

## 4. Prove end-to-end behavior
- Run real PQ wallet creation and sponsored deposit through the sidecar and record admission/status/inclusion evidence.
- Run a withdrawal through the public-proof pipeline and sidecar, including gas sponsorship.
- Run unit tests, browser custody checks, typecheck, lint and production build. Update EF/CROPS documentation with precise evidence and remaining limitations.
