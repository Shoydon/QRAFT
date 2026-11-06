# ERC-8286 migration design

## Intent
Make the active chain-1337 wallet follow ERC-8286's modular frame validation interfaces while preserving the simplified, atomic pool flow and one deployed account per wallet.

## Verified starting point
The legacy QraftFrameAccount inherits a vendored ERC8286FrameAccount. The active AtomicAccount does not: it imports LibERC8286 but embeds signature validation and lacks module lifecycle/configuration interfaces. AtomicFactory creates that account directly. AtomicPaymaster trusts the factory's accounts registry and pins the three-frame shape, nonce key zero, authorization calldata length and budgets. These bindings must change together.

## Approaches
1. Recommended: reference-style ERC8286AccountFactory plus a shared account implementation and shared ML-DSA frame validator. Each wallet is one immutable-argument clone. This follows the existing reference architecture closely and exposes standard module lifecycle/configuration. It adds shared implementation/module contracts, not per-wallet key-data contracts.
2. Extend the direct-deployment AtomicFactory and implement modular interfaces in AtomicAccount. Fewer shared contracts but larger per-wallet deployments and more independent account code to review.

ERC-8286 defines account/module behavior, not a mandatory canonical factory. Deploying a factory alone establishes no conformance.

## Proposed design
Use the protocol-dispatched route, declare supported frame modes, check every SENDER frame's mode, and mask validator results against frame and account approval scopes. Only the account calls APPROVE. Restrict module installation/configuration to authenticated account self-calls. Expose ERC-7579 configuration and lifecycle interfaces and ERC-8286 verify/supportsApprovalMode/executionRoute.

Implement a shared type-11 ML-DSA module against the current single wallet verifier. Bind each account to its prepared-public-key commitment through clone configuration. Supply prepared public data in transaction calldata; do not restore row contracts or descriptors. Read chain, sender, target, signing hash and scope from native frame introspection. Failed validation returns zero; no externally supplied transaction context is trusted.

Keep native transaction serialization compatible with the actual 1337 devnet. The published draft's signature transport differs from the pinned devnet's arbitrary-signature access; document and test that compatibility boundary rather than silently replacing opcode assumptions.

Deploy the reference factory, shared account implementation and module with pinned bytecode/provenance. Replace paymaster factory-registry assumptions with strict supported clone/configuration checks, keep bounded sponsored pool actions, and update wallet prediction, nonce selection, authorization encoding and budget measurement together. Module management requires a separately defined sponsorship policy; pool sponsorship must not silently cover arbitrary module installation.

Retain the deployed pool and proof verifier, preserving existing roots, deposits and notes. Deploy the replacement paymaster for the new account family. Preserve old wallet records with their version so existing funds remain accessible; do not reinterpret old accounts as modular clones.

## Acceptance
Compile and check artifact integrity; test unauthorized module changes, invalid signatures, wrong sender/chain, unsupported modes and excessive approval scopes. Confirm predicted and deployed clone addresses agree and malformed clones are not sponsored. On 1337 deploy two wallets, submit a sponsored deposit and proof-backed withdrawal through the alternative mempool, confirm receipts and balances, record per-frame gas and explorer links. Run the production build before publishing. Report conformance gaps explicitly.

## Approved decision
The user approved the reference-factory/clone architecture on 2026-11-07. The recommended reference approach introduces two additional shared roles (account implementation and validator module); each wallet remains one contract.

## Source
https://eips.ethereum.org/EIPS/eip-8286 (reviewed 2026-11-07)
