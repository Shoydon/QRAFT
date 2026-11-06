# ERC-8286 wallets on chain 1337

New wallets use the reference ERC8286AccountFactory to deploy one immutable-argument account clone. Shared roles are the account implementation, type-11 ML-DSA validator and paymaster, alongside the existing wallet verifier, withdrawal verifier and pool. There are no per-wallet public-key data contracts.

The factory source is pinned by `packages/frame-account/contracts/vendor/erc8286/provenance.json`. QRAFT's account implements protocol-dispatched ERC-8286 validation and ERC-7579 module/configuration interfaces. Only authenticated self-calls may install or uninstall a module. Module callbacks are ordinary calls; verification calls the module statically. The module obtains transaction context through frame introspection, verifies the ML-DSA signature against the account's committed public data and returns execution approval. The account masks that result against the frame allowance and its supported scope, checks all presented SENDER modes, and alone executes APPROVE.

The first keyed nonce selects the validator and is signed. New wallets read that nonce from the devnet nonce manager. Existing AtomicAccount wallets continue using their original paymaster and nonce-zero path. The frontend recognizes new wallets by deriving their deterministic factory address from the implementation, validator and public-key commitment. This avoids an extra network read before every transaction.

The paymaster pins implementation, validator, clone configuration and pool action shape. It funds deposits and withdrawals, not arbitrary module-management transactions. Modules installed by an owner are trusted to authorize the account. Removing the last validator can lock an account; there is currently no recovery module UI.

## Devnet compatibility

ERC-8286 remains a draft. This implementation follows its account/module interfaces and approval flow, with the pinned chain-1337 EIP-8141 encoding. That devnet exposes arbitrary signature bytes through its native introspection extension; the current published text instead describes passing custom signatures in validator data. We retain the working devnet signature transport and document this gap rather than claiming compatibility with every EIP-8141 revision.

The standard does not mandate a canonical factory. Infrastructure bootstrap uses native frames submitted directly to the execution endpoint because code-deposit budgets can exceed sidecar admission limits. Wallet creation, deposits and withdrawals use the alternative mempool. Existing pool roots and notes are preserved. Wallet authorization is ML-DSA-44; withdrawal proofs remain Groth16/BN254 with the existing development setup.

## Reproduction and evidence

- Build contracts: `node scripts/build-atomic.mjs`
- Check artifact integrity: `node scripts/check-atomic-artifacts.mjs`
- Deploy/reconcile shared contracts: `bun scripts/deploy-modular.ts`
- Two-wallet live flow: `bun scripts/test-modular-live.ts`
- Invalid-signature and sponsor rejection simulations: `bun scripts/test-modular-rejection.ts`
- Interface/access checks: `bun scripts/check-modular-live.ts`
- Browser creation: `node scripts/test-modular-create.mjs`
- Browser deposit/withdrawal: `node scripts/test-modular-app.mjs` (production server on localhost:3028)
- Build application: `npm run build`

Public pins: `public/modular-deployment.json`. Receipts/checks: `docs/pq/modular-live.json`, `modular-conformance.json`, `modular-creation.json`, and `modular-browser.json`. Local journals and wallet secrets stay under ignored `.local/` with private permissions.

Reference: https://eips.ethereum.org/EIPS/eip-8286
