# Native ETH protocol

The V1 circuit, proving key, WASM, verification key, verifier and Poseidon tree
originate from the local Himitsu project (`deepakA18/himitsu`, baseline commit
`ad639a7`, with the working-tree tree implementation). They retain the original
`himitsu.empty.leaf` tree domain for artifact compatibility. No proving setup is
regenerated. `artifacts.json` pins the imported public artifacts by SHA-256.

`NativePool.sol` adapts that construction to hold and transfer native ETH directly.
The withdrawal digest binds chain ID, pool address, denomination, root, nullifier
and recipient. There are no swaps, ERC-20 approvals or wrapped assets. Anyone may
submit a valid proof; the submitting wallet pays gas and is publicly visible.

The exported verifier retains its GPL-3.0 notice. The other imported Himitsu code
and QRAFT additions retain MIT licensing. This is a classical BN254/Groth16 proof,
not a post-quantum proof. The imported proving setup is a development setup; this
software is for disposable test funds only and has no independent audit.

Build: `npm run protocol:build`. Artifact packaging: `npm run prepare:proving`.
The lifecycle test generates real proofs against an isolated local EVM and checks
native ETH payout, recipient/domain binding, replay and failure rollback.
