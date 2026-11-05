# Native ML-DSA frame account reference

The imported codec targets the historical 8-field type-0x06 frame encoding deployed on Ethrex chain 8141. Do not assume the latest EIP draft uses the same encoding. QRAFT's browser client is in `src/lib/pq/account.ts`; its self-paying account configuration uses scopes 3, modes 15 and protocol route 0.

`HimitsuFrameAccount` and `HimitsuMldsaValidator` implement the public authorization cache and exact transaction-hash ML-DSA validation. The seven CC0 ERC-8286 reference files retain their upstream hashes in `contracts/vendor/erc8286/provenance.json`. They require the upstream OpenZeppelin immutable-args clone/ERC-7579 dependencies when rebuilt. The underlying ML-DSA verifier and pinned provenance are in `packages/protocol/vendor/mldsa44/`.

QRAFT uses the already deployed, runtime-hash-pinned factory, implementation, validator and verifier identified by `public/pq-deployment.json`. This import does not install Himitsu's ECDSA preparation account, closed test paymaster or proof worker; those are not the active account's authorization path. The local helper pays external gas with a separate disposable test key.

The verifier is experimental and not independently audited. Read `docs/pq/application-security.md` before interpreting the post-quantum scope.
