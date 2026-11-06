# Native Frame Service Implementation Plan

**Goal:** Use native type-0x06 transactions for account creation, funding, signature preparation, deposit, proof computation and withdrawal.

**Architecture:** Preserve the active chain-8141 account, pools, verifier and paymaster contracts. Replace the helper's EIP-1559 writer with a native frame writer using the protocol's EOA verification code, an isolated keyed nonce and an operator signature over the canonical frame hash. Deploy prepared public-key data through the existing deterministic CREATE2 proxy, with pinned runtime code. The user's signing key remains local and user spending remains ML-DSA authorized.

**Tech Stack:** Existing historical Ethrex frame codec, viem, Bun tests and Next.js.

## Decisions

A new ML-DSA deploy-prefix path would require changes to authorization caching and paymaster admission, plus new infrastructure. Native operator frames call the existing factory without changing wallet addresses or spending rules. Use that path for public setup and computation; do not describe operator authorization as post-quantum user authorization.

## Tasks

1. Add a testable native service-frame builder and decoder validation. Pin the deployment proxy runtime and derive deterministic deployment addresses from the operation label and initcode. Test signatures, calldata, nonce, fees, targets and frame shape.
2. Replace gasCall with a journaled native writer. Verify chain, proxy and operator code, simulate exact bytes, persist before broadcast, and verify raw type-0x06 receipts and payer. Reconcile confirmed legacy records but never rebroadcast a pending ordinary transaction.
3. Replace public computation windows with journaled native frames while preserving the single-writer lock, public-only allowlist, exact operation binding and progress reporting.
4. Add native-only boundary and recovery tests. Run typecheck, lint, unit tests, passkey checks and production build. Run a live native deployment/call using disposable test infrastructure and record receipts without exposing keys.
5. Update documentation and UI descriptions. Preserve local copy edits and all existing wallet and note formats. Scan tracked files and outgoing commit messages for forbidden project references before publishing if requested.

## Verification source

The pinned Ethrex source revision 64b8fc09d47d7787eb1a4e3f082aa9e831dc5f8c implements default EOA VERIFY with a canonical SECP256K1 signature. Its wire encoding has eight fields and keyed nonces. Use that historical codec, not the current draft's different encoding. Supporting transactions use a classical operator signature for public computation and gas only; the operator receives no user seed or note witness.
