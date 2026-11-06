# Native ML-DSA frame account reference

The imported codec targets the historical 8-field type-0x06 frame encoding deployed on Ethrex chain 8141. Do not assume the latest EIP draft uses the same encoding. QRAFT's browser client is in `src/lib/pq/account.ts`; its sponsored account configuration uses execution-only scope 2, modes 15 and protocol route 0.

`QraftFrameAccount` and `QraftMldsaValidator` implement the public authorization cache and exact transaction-hash ML-DSA validation. The seven CC0 ERC-8286 reference files retain their upstream hashes in `contracts/vendor/erc8286/provenance.json`. They require the upstream OpenZeppelin immutable-args clone/ERC-7579 dependencies when rebuilt. The underlying ML-DSA verifier and pinned provenance are in `packages/protocol/vendor/mldsa44/`.

The active factory, implementation, validator, verifier and paymaster pins are recorded in `public/pq-deployment.json` and `public/pq-pools.json`. Browser deposits and withdrawals use three native frames: ML-DSA execution approval, pool-paymaster payment approval, and execution. The helper also uses native frames for public-key data deployment, factory account creation, test principal funding, authorization caching and public proof computation. Its isolated operator nonce key is `0x5152414654`; the operator's ECDSA signature authorizes public service spending, not user custody. Data contracts are created through the pinned deterministic deployment proxy. Existing confirmed ordinary-transaction journals remain readable; pending ordinary transactions are never rebroadcast by this writer.

Wallet backup export is optional. A verified, unlocked wallet can sign without an acknowledgement flag. Public deployment transaction hashes are shown after creation and retained separately from encrypted custody metadata.

The verifier is experimental and not independently audited. Read `docs/pq/application-security.md` before interpreting the post-quantum scope.
