# Post-quantum proof setup on chain 1337

Use **`/pq`** for V5 hiding-STARK proof creation and verification. `/` is the separate, conventional Groth16 withdrawal application with ML-DSA wallet authorization. They use different pools, notes and deployment manifests; do not mix their backups or proof formats.

The PQ route uses `public/pq-deployment.json`: chain 1337, pinned genesis and runtime code hashes. Proving and first verification run inside a browser worker. The helper receives the public proof and public statement, never the note secret or Merkle witness. It independently verifies and encodes the proof, publishes public data and submits every staged verifier operation through the alternative mempool. Final withdrawal requires all proof gates to pass and consumes the bound session and nullifier once.

## Confirmed chain-1337 run

The complete V5 proof was accepted and consumed on 2026-11-06 UTC (2026-11-07 IST). [Public receipt audit](pq-v5-1337-live.json) reconciles all **663 verifier calls in 376 confirmed native-frame transactions**, the pinned runtime hashes, spent nullifier and final consumed progress `10,16,93,21,320,6080,12,0`.

[Withdrawal transaction](https://explorer.altmempool.wtf/tx/0x13d70a032ba5c2f7d5a6eda92310484d39fdc0af1327c4a409083c91fe58541a) confirmed in block **8,938**. The browser test checked an exact **0.0001 ETH** recipient increase and pool decrease, paymaster sponsorship, three successful frames, zero direct browser RPC POSTs, zero detected secret-bearing HTTP requests and zero browser page errors.

| Measurement | Confirmed result |
| --- | ---: |
| Public proof envelope | 10,312,806 bytes |
| Verification receipt gas | 5,666,166,607 |
| Final withdrawal receipt gas | 1,885,481 |
| Browser smoke-test proving time | 11.6 seconds |

Verification gas excludes proof upload and session setup. The browser smoke test is a separate fresh proof, not a timing measurement of this resumed live job. **This implementation does not meet the lower-gas goal.** Pairing input queries reduces transaction count relative to individual submission; no equivalent full-run gas baseline was measured, so no gas-saving percentage is claimed.

The live run required exact signed resubmissions after explicit sidecar cancellations ([recovery records](pq-relay-recoveries.json), [earlier recovery](pq-relay-recovery.json)). A browser RPC error after proof completion recovered by reopening the same saved flow. The lifecycle test passed payout assertions, then exposed a test interaction bug: it attempted to click behind the success dialog. The test now closes that dialog before spent-note reimport; the consumed note is checked separately in fresh browser storage ([result](pq-v5-spent-note.json)). These are resumable research operations, not an unattended production reliability claim.

## Run

Install the repository dependencies and preserve the existing ignored local operator configuration. The local service needs its funded devnet operator at `.local/alt-mempool-deployment/operator.json`, with mode 0600. Do not copy that file into documentation or source control. `QRAFT_DEPLOYER_KEY_FILE` can select another explicitly prepared chain-1337 operator file.

The public encoder needs the Rust example binaries described in [public-encoder.md](public-encoder.md), Python with `pycryptodome`, and the pinned browser assets in `public/pq-v5`. The current workspace has those prepared.

```sh
QRAFT_LOCAL_PQ_SERVICE=1 PYTHON="$PWD/.local/pq-python/bin/python" npm run dev
```

Open `/pq` on the printed localhost URL. Create/import a PQ wallet, deposit and save the V5 note. On withdrawal, import that note, choose the recipient and generate the proof. Leave the local helper running through public-data publication and staged verification. The UI supports resuming the same saved withdrawal; retain the same browser storage, note and service journals.

This is a desktop research setup. The fresh local browser check used about 2.19 GB WASM linear memory and approximately 12 seconds to generate a proof; those numbers are not RSS or mobile guarantees. On-chain verification is substantially slower and expensive. There are **663 verifier operations**, grouped into atomic frame transactions where their execution/state budgets permit. This is not a compact single-transaction PQ proof.

## Check

```sh
bun test tests
node packages/pq-hiding-stark/scripts/test-browser-v5.mjs
node scripts/test-pq-public-export.mjs PUBLIC_ENVELOPE EXPECTED_PUBLIC_JSON
```

For an existing published job, use the browser lifecycle test with protected local backups:

```sh
QRAFT_BROWSER_URL=http://localhost:3012 \
QRAFT_TEST_WALLET=/absolute/path/to/pq-wallet-backup.json \
QRAFT_TEST_NOTE=/absolute/path/to/pq-note.txt \
QRAFT_TEST_JOB=PUBLIC_JOB_ID \
node scripts/test-pq-app.mjs
```

The test defaults to `/pq` and allows two hours for staged verification and withdrawal. `QRAFT_TEST_WITHDRAWAL_TIMEOUT_MS` overrides that test wait only; it does not change the proof-bound deadline. `QRAFT_TEST_STORAGE_STATE` can restore a previously saved local Playwright state file. A resumed job retains its original recipient, deadline and session. The test checks exact recipient/pool balance changes, paymaster sponsorship, three successful native frames, absence of direct browser RPC POSTs and known secret bytes in HTTP payloads, and spent-note reimport rejection. These traffic checks are scoped tests, not a proof of endpoint anonymity.

After success, independently reconcile the public job and all verification receipts:

```sh
bun scripts/check-pq-live.ts PUBLIC_JOB_ID
```

The checker requires final progress `10,16,93,21,320,6080,12,0` (Consumed), validates pinned runtimes and the spent nullifier, reconciles all 663 batched calls, checks the withdrawal event and writes `docs/pq/pq-v5-1337-live.json`. It refuses an incomplete or unrelated browser result.

## Interrupted jobs

Do not delete signed transaction journals or allocate a fresh nonce to replace an uncertain submission. Reconcile receipts and nonces first. The carrier lock deliberately refuses to steal a dead process's lock; remove it only after checking every outstanding signed operation and confirming the recorded owner is dead. Restart the helper, then resume the same saved withdrawal. Public proof computation is permissionless, but the final withdrawal still needs the appropriate wallet authorization and exact proof-bound context.

For maintenance while another server is processing a job, build into the isolated Next.js directory:

```sh
QRAFT_ISOLATED_PQ_BUILD=1 npm run build
QRAFT_ISOLATED_PQ_BUILD=1 QRAFT_LOCAL_PQ_SERVICE=1 \
  PYTHON="$PWD/.local/pq-python/bin/python" npm run start -- --port 3012
```

This leaves the running server's `.next` assets intact. Both instances share proof journals and the carrier lock. Stop the old server only after its active work finishes or its signed operations have been reconciled.

## Security scope

V5 is a transparent hash/FRI hiding proof with a conditional post-quantum argument, not an independent security audit or a certified 128-bit PQ system. See [the security argument](pq-v5-security-argument.md). The devnet consensus, operator's gas-carrier ECDSA authorization, browser environment and network privacy have separate assumptions. WHIR research artifacts are not connected to this pool and cannot authorize a withdrawal here.
