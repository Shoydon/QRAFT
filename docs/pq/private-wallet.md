# Qraft private wallet

The application at `/app` now uses a native ETH join/split pool. Wallets discover encrypted incoming payments, display one private balance, select up to four inputs, and return private change. Users manage one encrypted recovery file instead of individual notes.

The approved architecture and written flows are in [the design](../superpowers/specs/2026-11-07-private-wallet-design.md). The implementation plan is [here](../plans/2026-11-07-private-wallet.md).

## Components and boundaries

- `packages/private-pool/circuits/join-split.circom`: four-input, two-output Groth16 circuit, depth-20 Poseidon tree, 128-bit wei values, fourteen public signals.
- `packages/private-pool/contracts/PrivatePool.sol`: native ETH custody, proof verification, nullifiers, immutable action digest, encrypted output events, atomic withdrawal.
- `PrivatePaymaster.sol`: devnet native-frame sponsorship for the pinned modular account and pool. Sponsor funds are finite; this development sponsor does not enforce per-user quotas.
- `src/lib/private-wallet/`: key derivation, ML-KEM receiving descriptors, authenticated encryption, portable recovery, passkey vault, discovery worker, proof worker, selection, reservations and receipt validation.
- `src/components/PrivateWalletApp.tsx`: wallet creation/unlock, one private balance, exact amount review, Add/Send/Receive/Withdraw, explicit consolidation, backup and restore.
- `/api/private/relay`: independently keyed shared carrier. Browser sends only the public action and proof. The relay executes `eth_call` against the real pool before signing native frames.

ML-DSA-44 signs public-account/native-carrier authorizations; ML-KEM-768 encrypts receiving payloads. Private ownership is a secret-preimage relation in a conventional BN254 Groth16 circuit. **This is not an end-to-end post-quantum payment system.** Separate signing, spending and receiving keys derive from one master secret; users do not create or back up a separate viewing key.

Chain reads and user deposit submissions use the existing Nym transport. Private sends and withdrawals reach the shared relay over HTTPS. That relay sees the requesting IP and timing. Public deposit and withdrawal amounts/addresses remain visible. ML-KEM confidentiality does not establish anonymous recipient selection or prevent traffic correlation.

Nym startup bounds both TCP connection attempts and exit-node (IPR) attempts. The pinned worker supports `iprAttemptTimeoutMs` and `iprMaxAttempts` through its [mix-tunnel 0.3.0 option types](https://cdn.jsdelivr.net/npm/@nymproject/mix-tunnel@0.3.0/dist/esm/types.d.ts). Private-wallet reads retry up to three times; submissions retain their signed identity. Reconnecting never enables a direct read fallback.

## Local setup

Use the repository's installed dependencies and existing native-frame compiler setup. To install the isolated circuit toolchain, run:

```sh
npm install --prefix .local/private-wallet-tools --no-audit --no-fund circom2@0.2.23 circomlib@2.0.5
npm run private:build
node scripts/check-private-artifacts.mjs
```

`public/private-proving/manifest.json` records source/R1CS hashes, compiler version and artifact SHA-256 hashes. The checked-in proving key and verifier belong to the current deployment. A changed circuit requires explicit `--new-dev-setup` and redeployment. Rebuilding unchanged sources reuses the existing proving key. Do not generate different parameters and keep the old verifier address.

The parameter setup is **single-operator development-only**, with power-16 capacity for the approximately 51,000-constraint circuit. It is not a production ceremony. Initial preparation can take several minutes. Generated intermediate files live under ignored `.local/`; no test or operator secret belongs in public artifacts.

Deployment commands (EF devnet 1337 only):

```sh
bun scripts/deploy-private-pool.ts
bun scripts/fund-private-relay.ts --execution-bootstrap
```

Deployment uses the existing mode-0600 operator file under `.local/alt-mempool-deployment/`. Shared ML-DSA account implementation/factory/validator pins come from the modular deployment. The new pool, hasher, verifier and sponsor are pinned in `public/private-deployment.json`.

Infrastructure bootstrap may use the execution endpoint. Wallet transactions use native frames through the alternative mempool. There is no automatic app fallback to direct execution.

## Relay operation

Run the relay on **one host with durable local disk**, with one writer for its carrier key. The Next.js route reads `.local/private-relay/carrier.json`; this file has private permissions and is not bundled into builds. Ordinary ephemeral function storage is unsuitable. Multiple independent instances must not share this carrier without replacing the filesystem journal/lock with a transactional coordination service.

Each action digest has an immutable signed-transaction journal written before broadcast. A retry submits the same raw transaction. The relay checks unresolved prior submissions before allocating a nonce. A lock records the process PID; it is reclaimed only if that process no longer exists. A malformed/empty lock fails closed and requires operator inspection after confirming no process is submitting.

The relay retains expired journals. After the pool's proof expiry plus a 30-second chain-time margin, the old action can no longer transfer value, so an unconsumed nonce may be used for a new action. An old transaction racing that nonce can cause a failed/retried submission, but cannot execute the expired payment. The browser also retains its last expired intent for diagnosis and rebuilds the balance before allowing another payment.

Never delete a journal merely because an RPC timed out. Check the canonical receipt, pool settlement event, nullifiers and expiry first. Do not send private spending secrets, note witnesses, master seeds or recovery passwords to this service.

## Recovery and confirmation

The passkey seals the master secret locally. A separate portable file encrypts that same secret using a password-derived scrypt key and AES-GCM. Export performs a local decrypt/identity round trip before allowing backup acknowledgment. A new device imports the portable file and creates its own passkey.

Discovery rebuilds the commitment tree from encrypted pool events, checks the root against the same canonical head, decrypts locally in a worker, and excludes spent nullifiers. An incomplete or changing history fails the sync; it does not become a zero balance. The wallet refreshes while idle and when it becomes visible.

New recovery applies a five-minute chain-time spending quarantine. Avoid concurrent sending from another device holding the same recovery secret; this is not key revocation.

Confirmation requires a successful native three-frame receipt, the expected sponsor, a canonical block, one subsequent block, and a `Settled` event from the pinned pool matching the exact action digest. A relay's response alone cannot establish success. A failed deposit receipt and an unknown outcome are distinct.

## Verification

```sh
bun test tests
npm run typecheck
npm run lint
QRAFT_PRIVATE_BUILD=1 npm run build
node scripts/test-private-pool.mjs
bun scripts/test-private-live.ts
```

For browser testing, start a stable production build on localhost (passkeys require a hostname):

```sh
QRAFT_PRIVATE_BUILD=1 npx next start --hostname 127.0.0.1 --port 3109
QRAFT_PRIVATE_TEST_URL=http://localhost:3109 node scripts/test-private-browser.mjs
QRAFT_PRIVATE_TEST_URL=http://localhost:3109 node scripts/test-private-e2e.mjs
node scripts/test-private-nym.mjs
# Additional full flow with actual mixnet transport (availability dependent):
QRAFT_PRIVATE_REAL_NYM=1 QRAFT_PRIVATE_TEST_URL=http://localhost:3109 node scripts/test-private-e2e.mjs
```

The browser and end-to-end harnesses explicitly inject direct **test reads** to separate wallet correctness from mixnet availability. They do not add a direct fallback to application code. The end-to-end harness uses real provisioning and relay APIs, real browser proofs, native alternative-mempool submissions and devnet balances; its operator faucet is only test infrastructure. The separate Nym test uses the actual configured worker.

Evidence is written only after each entire test passes: `private-pool-local.json`, `private-pool-live.json`, `private-wallet-browser.json`, `private-wallet-e2e.json`, and `private-wallet-nym.json` in this directory. Failures and test recovery files stay under ignored `.local/`.

## V1 limits

ETH only; full pool history scanning; four inputs/two outputs; explicit combination when a payment needs more inputs; one shared relay carrier; finite sponsorship. No selective viewing-key export, auditor feature, token swaps, bridges, or production privacy/security claim. STRK20 inspired the product flow; this implementation does not use its STARK proof system or scalable channel discovery.

### Nym integration result

The full live browser flow passed with injected test reads. A separate actual-Nym full-flow attempt confirmed two deposits and successfully settled the private payment, but stalled while reconciling a deliberately dropped relay response after reload. It did not complete recovery and withdrawal through Nym; see `private-wallet-e2e-nym-attempt.json`. The app now reconnects on timed-out read retries while retaining the exact pending payment. Browser regression coverage injects a timeout and verifies that reconnect restores discovery. A full uninterrupted Nym E2E pass is still outstanding; mixnet availability remains a demo risk.
