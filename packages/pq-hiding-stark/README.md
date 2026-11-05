# Himitsu direct hiding-STARK withdrawal proof

The current **v5** profile proves knowledge of a64-byte secret and a hidden depth32
SHA3-512 Merkle path. It constrains the nullifier to SHA3-512 of the first32 secret
bytes and binds the public withdrawal context. That context covers chain, pool,
asset, denomination, recipient, relayer, fee and deadline. The pool derives it
independently and maintains known roots and globally spent nullifiers.

The package now includes native and browser proving, native/browser verification,
a complete staged Solidity verifier, immutable public-proof data storage, and a
fixed-denomination native ETH pool. The v5 stack has deployed on the user-selected
Chiranjeev devnet, chain 8141. A real 0.0001 ETH deposit, complete v5 proof
verification and exact withdrawal have all confirmed. All 725 verification and
withdrawal transactions succeeded; nine negative checks rejected incomplete,
unauthorized, altered and replayed withdrawals. Independent reconciliation checked
every receipt, all seven runtime hashes, the spent nullifier and the recipient's
net payout. Receipts and measurements are in
`../../docs/pq-hiding-stark-v5-live-evidence.json`; deployment addresses and runtime
hashes are in `../../docs/pq-hiding-stark-v5-deployment.json`.

## Claim and scope

The implemented protocol supports a conditional postquantum computational
zero-knowledge argument of knowledge for the fixed withdrawal AIR, with
fresh-context authorization after prior proofs under the named joint-note one-way
and binding assumptions. The complete argument, finite bounds, normalization
lemmas and independent review scope are in
`../../docs/pq-v5-security-argument.md`. This is a random-oracle/hash/quantum-PRG
claim, rather than an unconditional assertion about concrete hash functions.

This is a transparent hash/FRI proof, with no elliptic-curve pairing verifier and no
trusted setup. The fixed profile uses Goldilocks' degree5 extension,320queries,
blowup16, binary FRI, five randomizer columns and salted hiding Merkle commitments.
BLAKE2b-512 supplies the proof commitments/challenge keys through Ethereum's existing
EIP152 precompile. SHA3-512 supplies the note and tree hashes inside the AIR.

V5 implements the published series-parallel BCS compiler in the total-order case:
one64-byte proof salt, a BLAKE2b-512 challenge key, a standard cSHAKE2562560-byte
stream, and the first64 stream bytes written into the next transcript prefix.
Its16logical verifier moves include one joint320-query vector. The exact sampler
has equal-size preimages and a constructive conditional-preimage sampler.
Merkle leaf salts use16uniform field elements; their actual finite support is
accounted for directly rather than incorrectly calling their encoding uniform bytes.
See `strong_config.rs`, `strong_transcript.rs` and the separate finite-salt proof.

There is no uniform128-bit certificate or independent external audit. The
fresh-statement weak simulation-extraction result used in the stated security
argument is narrower than generic strong simulation extractability. Neither it
nor passing tests certifies the surrounding chain, browser or endpoint privacy.
The old preimage/v1/v2/v3/v4 examples remain separately named diagnostic profiles.
Groth16 notes elsewhere in the application are not reinterpreted as PQ notes.
The replacement pool is not silently enabled in the application UI.

## Complete verifier

`contracts/src/WithdrawalVerifierSessionV5.sol` pins the arithmetic, authentication,
AIR and public-data-store implementations. Session state derives the transcript,
challenges, indices and exact expected statement. Completion requires all93fixed
AIR batches, quotient identity, all21claim projections,320DEEP queries with6080
input matrices, and12authenticated FRI rounds. The consuming pool alone can consume
an exact complete statement, once. There is no administrative accept-proof path.

The chosen devnet has a128KiB canonical transaction cap. Sealed public data uses
fixed-size STOP-prefixed immutable code chunks; no private witness belongs there.
The Amsterdam execution/state gas dimensions are separate. Live deployment uses
node estimates, not a sum incorrectly compared with the execution-only cap.

A genuine local v5 session passed727staged calls. Each call independently stayed
below16,777,216legacy execution-plus-intrinsic gas and131072calldata bytes; the
largest observed call was about13.26Mgas/34.1KiB. The live runner uses native-
authenticated32-query FRI subsets to reduce transaction count. None of these
measurements is a production cost or mobile-readiness claim.

The live v5 run used 724 verification transactions plus one withdrawal transaction,
with about 6.43 billion combined gas in total. Its largest transaction used
13,846,191 combined gas and its largest calldata was 34,020 bytes. This is a working
staged verifier, not a practical single-transaction replacement for Groth16.

## Reproduce from the repository root

```sh
python3 packages/pq-hiding-stark/scripts/prepare-upstream.py
python3 packages/pq-hiding-stark/scripts/test-upstream-integrity.py
cargo test --locked --release --manifest-path packages/pq-hiding-stark/Cargo.toml --lib
python3 packages/pq-private-proof/contracts/scripts/prepare-test-deps.py
forge test --root packages/pq-hiding-stark/contracts --gas-limit 100000000000
node packages/pq-hiding-stark/scripts/build-wasm.mjs
node packages/pq-hiding-stark/scripts/test-browser-v5.mjs
```

The large Forge gas limit is for the aggregate in-process test containing thousands
of simulated transactions. The test separately bounds every staged call. It does
not start a node or change a devnet's limits. Use edition2024 Rust and wasm-bindgen
0.2.127; set `CARGO`/`WASM_BINDGEN` when needed. Browser tests use the repository's
existing Playwright dependency and terminate every Worker.

Recorded validation:63Rust library tests,237Solidity tests, and eight v5 browser
checks. A Chromium run proved in8.4s and verified in164ms, with a10.33MB public
envelope and about2.04GiB WASM linear-memory high-water. That is not measured RSS.
The default test made zero external requests and exports no witness or proof.
An additional `--export-public-proof` run exported only the public browser proof
locally; `examples/verify_public_v5.rs` accepted it against a separate public
statement and rejected a changed context. No witness crossed that browser/native
verification boundary.

`examples/prove_withdrawal_v5.rs` takes a0600 private input file and writes only public
proof artifacts. The portable session exporters verify the canonical native proof,
restore authentication paths and bind outputs to source SHA256 digests. The live
runner defaults to read-only validation; broadcasting requires an explicit nonce
handoff. It journals signed transaction hashes before posting and never retries an
uncertain transaction with a fresh nonce.

## Attribution

Plonky3 `0d803737b681774186cd283b1fd2d8e493655c82` is used unchanged under its
MIT/Apache-2.0 licenses. The preparation script verifies its archive SHA256 and all
1389cached source files without Git operations. The Keccak AIR, hiding PCS and FRI
machinery are upstream work. The compiler security argument uses published
results, linked in the claim ledger. Himitsu's work is the withdrawal relation,
two-layer stream/write-back compiler adapter, standard wide-hash profile and complete bounded EVM
integration. No new cryptographic primitive or world-first claim is made.
