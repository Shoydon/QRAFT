# Public V5 proof encoder

This bridge takes an already-created **public** V5 proof envelope and a separate
expected statement. It never accepts a note secret, signing seed, Merkle witness
or private proving input. It performs no RPC calls, signing, proving or submission.
The browser remains responsible for local proving and verification.

Build and encode:

```sh
node scripts/prepare-pq-public-proof.mjs \
  --envelope /path/to/public-envelope.postcard \
  --statement /path/to/expected-public.json \
  --output .local/public-proof-example \
  --build
```

`--build` invokes the pinned upstream integrity check and builds the three native
public encoders. Later runs can omit it. `CARGO` selects the Cargo executable;
otherwise the script uses `$HOME/.cargo/bin/cargo`. `PYTHON` defaults to `python3`.
Python needs the existing public encoder dependency `pycryptodome`.

The expected JSON has exactly these fields:

```json
{
  "profile": "himitsu-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16",
  "root": ["64 byte values, represented as JSON numbers"],
  "nullifier": ["64 byte values, represented as JSON numbers"],
  "context": ["64 byte values, represented as JSON numbers"],
  "publicContext": {
    "chainIdHex": "32-byte hex",
    "poolHex": "20-byte hex",
    "recipientHex": "20-byte hex",
    "relayerHex": "20-byte hex",
    "denomination": "100000000000000",
    "fee": "0",
    "deadline": "1800000000"
  }
}
```

The root/nullifier/context arrays must contain exactly 64 integers in `0..255`.
Hex fields may have a `0x` prefix. Integer strings must be canonical unsigned
decimal values. The example above describes array shape, not a runnable fixture.
Unknown fields are rejected, including nested secret/witness fields. Native ETH
is fixed by `asset = address(0)` in the independently derived withdrawal context.
The caller must still establish the expected deployment, root, recipient and
policy independently; proof verification alone does not establish chain state.

The native exporter checks the entire V5 envelope and context before writing any
exported proof material. It rejects unknown profiles and trailing proof bytes.
The Node coordinator freezes the input bytes and creates an isolated generation,
verifies transcript streams, the AIR quotient identity, input authentications and
FRI authentications, then publishes the complete output directory by rename.
Inputs are limited to 16 MiB for the public proof and 16 KiB for the statement.
Child processes have timeouts. A request-facing service should also restrict
concurrency and apply its own process resource isolation.

Output layout:

- `withdrawal-proof/`: verified fixture, envelope, proof, transcript hashes, summary.
- `withdrawal-transcript/`: verified public challenge streams and samples.
- `withdrawal-codec/`: claim encoding, AIR window and quotient data.
- `input-vectors.json`, `fri-vectors.json`: native-authenticated public openings.
- `session-vectors/`: 320 input ABIs, 120 FRI subset ABIs and material ABI.
- `public-preparation-summary.json`: input bindings, output SHA-256 map and completion metadata.

A repeated call with the same inputs reuses output only after verifying every
recorded file hash. A changed input, corrupted output or partial output directory
is preserved and rejected. Incomplete work remains in an isolated `.public-work-*`
directory. Never treat preparation completion as proof of onchain verification;
the deployed staged verifier must still execute and accept every required gate.

The import API is `preparePublicProof({ envelope, statement, output, build,
onProgress })`. The progress callback receives fixed stage names only. The CLI
emits JSON progress lines and one final public summary. No proof or witness is
printed.

Focused checks, using an existing verified **public** fixture:

```sh
cargo test --locked --release \
  --manifest-path packages/pq-hiding-stark/Cargo.toml \
  --example export_browser_v5
node scripts/test-pq-public-export.mjs \
  /path/to/public-envelope.postcard /path/to/expected-public.json \
  --prepared .local/public-proof-example
```
