# Native ETH Pool Implementation Plan

Historical classical implementation plan. Superseded for the active application by [the PQ scope](2026-11-06-pq-stack.md).

> **For Codex:** Use executing-plans to implement this plan task by task.

**Goal:** Replace QRAFT’s simulated deposit and withdrawal adapters with a working native ETH privacy pool, using Himitsu’s existing note circuit and browser proving material.

**Architecture:** Preserve the QRAFT UI, file-based notes, and adapter boundary. Reuse the Himitsu depth-10 Poseidon tree and existing Groth16 circuit; bind the proof to the chain, pool, denomination, nullifier and recipient. Hold and pay native ETH directly. Route application reads through the official Anon-RPC Nym worker; fail closed if anonymous transport is unavailable. Wallet RPC remains responsible for signed submissions and account access.

**Tech Stack:** Next.js, TypeScript, viem, Solidity, Circom/Groth16, snarkjs, Anon-RPC.

---

### 1. Native ETH protocol and reproduction
- Import the exact Himitsu V1 circuit, verifier, public verification key and proving artifacts with source attribution and checksums.
- Add an ETH-only pool with fixed denominations, duplicate protection, reentrancy protection and recipient/domain-bound withdrawal verification.
- Add reproducible compile/deploy tooling and local EVM lifecycle tests covering native payout, invalid proofs, replay, wrong recipient and reverted payout.

### 2. Browser backend and proving
- Add typed pool ABI, manifest validation, chain/genesis/runtime checks, canonical event reconstruction and note witness generation.
- Implement real deposit, proof worker, withdrawal and receipt adapters. Keep secrets in browser memory. Preserve unknown submission outcomes.
- Default to real mode and official Nym reads. Never fabricate a connected account when no wallet exists.

### 3. UI and transport integration
- Wire the existing deposit/withdraw journeys to real adapters, wallet network setup and accurate gas/payment states.
- Fix pending/unknown reconciliation and simulation labels. Include useful startup and transport errors.
- Verify production build and browser flow, including proof generation and native ETH payout.

### 4. Deployment and handoff
- Check public devnet availability and deploy only against verified disposable test infrastructure, with deployment keys kept local and ignored.
- Publish public deployment identity, artifact checksums and reproduction commands.
- Update README and PRODUCT with actual behavior, source attribution, ETHGlobal resources, trust assumptions and remaining limitations.
- Run typecheck, lint, build, contract lifecycle and browser checks.
