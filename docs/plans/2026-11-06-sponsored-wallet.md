# Sponsored Wallet Implementation Plan

**Goal:** Create and restore browser ML-DSA wallets backed by deployed smart accounts on Ethrex devnet 8141, with funded native-frame gas sponsorship.

**Architecture:** Keep key generation and signing in the browser. The local helper deploys public key rows and the account clone, and computes public signature caches. A storage-free, bounded paymaster approves payment for valid QRAFT account frames; the ML-DSA validator independently approves execution. Deploy the current QRAFT proof namespace before enabling the application.

**Tech Stack:** Next.js, TypeScript, viem, Solidity with the pinned EIP-8141 compiler, native Rust/WASM V5 prover.

## Implementation

1. Add reproducible frame-contract dependency preparation/build scripts, checking compiler and upstream source hashes.
2. Implement `QraftPaymaster.sol`: pin implementation/validator/protocol addresses, validate exact clone configuration and three-frame shape, bound nonce, fees, gas, calldata and supported actions; owner controls sponsor treasury only.
3. Update account provisioning and recovery to execution-only clones. Build three-frame transactions and independently verify the paymaster in simulation, receipts and saved-intent reconciliation.
4. Refresh the V5 Solidity preprocessing root from the native canonical key. Compile and deploy changed contracts using a durable signed-transaction journal; verify runtime templates and immutable constructor bindings.
5. Fund the paymaster with disposable devnet ETH, update verified manifest/ABIs and enable the local service. Keep prior deployment pins recoverable outside the active configuration.
6. Extend tests for sponsored receipts, changed payer, malformed payment frames, signature failures, backup restore and account ownership. Update the browser lifecycle runner for the current UI.
7. Exercise fresh browser creation, account deployment, backup, restore and native sponsored deposit/withdrawal. Reconcile receipts, nonce use, paymaster debit and exact principal payout; record public evidence only.

## Constraints

- User seeds, private notes and witnesses stay in the browser; only protected disposable test backups are saved by the integration runner.
- No fresh-nonce retry after an uncertain broadcast. Check chain/genesis, pending nonce, balance and runtime pins before spending test ETH.
- Sponsorship pays gas only and grants no user execution authority. This is direct native-frame execution on chain 8141, not evidence of alternative-mempool admission on chain 1337.
- Preserve the existing UI changes and keep the project namespace consistent in source and packaged artifacts.
