# QRAFT

**Quantum-Resistant Anonymous Frame Transactions** — a native ETH privacy-pool application. Deposit **0.0001 ETH**, save a private note, and withdraw the same amount in native ETH to a recipient. No wrapped asset, token approval or swap is involved.

The active application uses ML-DSA-44 account authorization, SHA3-512 notes and Merkle commitments, and the transparent V5 withdrawal proof. User signing seeds and note witnesses stay in the browser. This is experimental devnet software: the proof construction has a conditional security argument, not an independently established quantum-security certificate or a production audit. See [security boundaries](docs/pq/application-security.md).

## Deployment status

The active configuration targets the EF alternative-mempool devnet, chain **1337**. Shared contracts are pinned in [pq-deployment.json](public/pq-deployment.json). The default 0.0001 ETH pool is deployed; additional denominations are not yet activated on this network. Transactions are currently disabled: PQ execution simulation succeeds, but the sidecar rejects the sender under its GAS opcode rule (OP-011). See [EF track status](docs/pq/ef-track.md).

Wallet creation follows a public provisioning job and independently verifies ownership through Nym before opening. Creation can take several minutes. Local helper requests queue behind one shared gas-carrier lock across processes; interrupted locks require journal reconciliation.

The historical full withdrawal evidence predates this deployment. Current wallet, deposit, proof, and withdrawal checks must be described separately; deployment alone does not establish a complete withdrawal lifecycle.

## Run locally

Use Node 22.23+ (or Node 24), Rust/Cargo, Python 3, and Bun for unit tests. Keep the `PYTHON` environment variable set when starting the helper so its encoder can load PyCryptodome.

```sh
npm ci
python3 -m venv .local/pq-python
.local/pq-python/bin/pip install -r packages/pq-hiding-stark/requirements.txt
export PYTHON="$PWD/.local/pq-python/bin/python"
npm run prepare:pq
npm run dev
```

Open **http://localhost:3000/app** for the PQ application. The landing page at `/` explains the project and links into `/app`. Startup checks the checked-in browser prover hashes. `prepare:pq` verifies and unpacks the pinned upstream archive and builds the public-only native encoder; it does not generate private notes or a trusted setup.

Account creation and public proof processing require the optional local helper. In `.env.local`, set:

```dotenv
QRAFT_LOCAL_PQ_SERVICE=1
QRAFT_DEPLOYER_KEY_FILE=.local/alt-mempool-deployment/operator.json
```

Supply a funded, disposable **chain 1337** gas-carrier key in that protected JSON file, with fields `chainId` (1337) and `privateKey` (0x-prefixed 32-byte key). Protect it with `chmod 600 .local/alt-mempool-deployment/operator.json`. Never use a mainnet key. No key is shipped. This workspace already has local test configuration; restart after changing environment variables.

The helper provisions public ML-DSA account data, funds 0.0001 test ETH as initial deposit principal, stakes newly created accounts and pays for public proof computation. It cannot produce an ML-DSA authorization or withdraw from the pool without a valid note proof. All new helper writes use native type-0x06 frames, including account/public-key deployment, test funding, public proof computation. The operator uses the protocol default EOA verification code and pays for these public operations; user deposits and withdrawals retain ML-DSA authorization and paymaster sponsorship. It uses direct RPC, so this local configuration does **not** provide anonymity for all traffic. Keep it bound to loopback; it is not an authenticated public faucet or hosted service.

## Try the flow

1. Open the local app using `localhost` (passkeys cannot use an IP address), or use its HTTPS domain. Create a PQ wallet and enroll a passkey that supports WebAuthn PRF. The wallet picker lists saved wallets, supports renaming, and offers Create another wallet; default names are Wallet 1, Wallet 2, and so on. Its signing key is saved encrypted in the browser. Downloading an encrypted backup is optional and does not block transactions.
2. Choose the amount, generate a note, and copy it into a safely saved text file. Acknowledge the note backup.
3. Deposit the selected amount. The ML-DSA account signs the native frame transaction; that pool’s paymaster pays its gas. The account must hold the deposit principal.
4. Open Withdraw, import the note, and enter a fresh recipient address. Use a separate PQ account for withdrawing if you want to avoid directly linking both actions; save its backup too. The default account is not automatically rotated.
5. Generate the proof and withdraw. The browser proves and verifies locally, then sends only the public proof and statement to the helper. Native ML-DSA transactions open and attach the verification session; the helper executes the public computation, and the account authorizes the final withdrawal.

Keep **both** backups and access to the wallet’s matching passkey. Wallet files and browser local storage contain an AES-256-GCM encrypted signing seed, protected by a WebAuthn PRF key through HKDF-SHA-256. Reloading starts locked without a passkey prompt. Choose Connect wallet, then Wallet found · Unlock with passkey; canceling leaves it locked so you can retry. Unlock decrypts local custody immediately; balances load in the background and network verification happens before transaction submission. The decrypted seed and encryption key stay in memory during the unlocked session. A wallet backup requires its matching passkey on the original domain; losing that passkey prevents recovery. Legacy plaintext wallet imports are encrypted before adoption. Notes remain separate bearer secrets and are not persisted in local storage. Neither signing seeds nor note witnesses are sent to the helper. Import the encrypted wallet backup to restore signing access; import the note to recover a withdrawal. Public transaction and workflow journals support resuming interrupted operations. An unknown transaction outcome must be reconciled before a new action; do not delete journals to bypass it. A receipt proves inclusion, not irreversible finality.

Desktop Chromium is recommended. V5 proving currently uses approximately **2.04 GiB** of WASM memory and produces a roughly **10.3 MB** public envelope. Onchain verification is split across 663 calls and can take tens of minutes, depending on RPC and devnet throughput. The browser reports progress. Anonymous RPC may add substantial latency.

## Network and verification

The default deployment is pinned in [public/pq-deployment.json](public/pq-deployment.json): EF devnet **1337**, execution RPC `https://altmempool.forshtat.com`, sidecar `https://altmempool.forshtat.com/rpc`. Genesis, an anchor block, contract runtime hashes, denomination and account configuration are checked before use. A devnet reset invalidates the deployment and its notes.

Browser chain requests use the official Nym Anon-RPC worker by default and stop on failure, with no automatic direct fallback. The worker lookup uses a direct Ethereum bootstrap RPC. Explicit passthrough mode is labelled non-anonymous. The local helper and CLI diagnostics use direct RPC. See [.env.example](.env.example).

```sh
npm test
npm run check
npm run doctor
npm run test:pq:browser
npm run test:browser
```

`doctor` checks the active PQ deployment and browser artifact hashes. `test:pq:browser` checks the browser proof and mutations without depositing. `test:browser` performs a real fresh-account deposit/restore/withdrawal test against the locally running application (default port 3006), uses disposable devnet ETH and saves protected backups/evidence under ignored `.local/`. Start it with `npm run start -- --port 3006` after building. Unit tests need Bun. Install the browser test runtime with `npx playwright install chromium` if it is not already present. Rust tests run from `packages/pq-hiding-stark` after upstream preparation. Public encoder boundary checks are documented in [public-encoder.md](docs/pq/public-encoder.md).

The historical [live integration evidence](docs/pq/application-checks.json) records a fresh native deposit, browser V5 proving, all 663 successful verifier calls, browser-session recovery, exact 0.0001 ETH payout and spent-note rejection. The [receipt screenshot](docs/pq/withdrawal-receipt.png) shows the confirmed native withdrawal. This test reused its deposit account for gas and makes no unlinkability claim. Browser request counters in that report cover the resumed session.

If Nym reads time out, open the read-path footer, reconnect anonymous reads, and retry the same backup or saved workflow. Never discard an unresolved signed intent or switch to a replacement nonce to work around a timeout.

## CROPS

- **Censorship resistance:** wallet backups restore ownership without the provisioning helper. Reads still depend on available Nym infrastructure and RPC providers; creation and public proof processing currently depend on the local helper.
- **Open source:** source, pinned proving dependencies, and build instructions are included. Dependency licenses and required notices are listed in [NOTICE.md](NOTICE.md).
- **Privacy:** signing seeds and note witnesses stay in the browser. Default chain reads use Nym. The bootstrap provider sees the worker lookup, and the helper sees public account/proof data and uses direct RPC. Timing, gas funding, pool size, and recipient reuse can link activity. No third-party analytics are configured.
- **Security:** ML-DSA authorization, deployment pins, local proof verification, and recoverable transaction journals protect the application flow. The proof is experimental; external consensus and transport are outside its post-quantum claim. Keep both backups.

For exact EF endpoints, deployment prerequisites, and implemented versus pending features, see [EF track status](docs/pq/ef-track.md). The historical pool is on chain 8141; the EF alternative mempool target is chain 1337. The client submits JSON frame transactions with `eth_sendFrameTransaction`. PQ signatures are verified directly in the sender VERIFY frame; application writes have no canonical-mempool fallback. Shared infrastructure bootstrap is explicitly separate.

## Source and license information

Source attribution and dependency licensing are recorded in [NOTICE.md](NOTICE.md). Historical Groth16 contracts and scripts remain for development reference; the active `AppShell` loads the PQ application. Legacy `protocol:*`, `prepare:proving` and `test:protocol` scripts do not exercise the active PQ path.

The [ETHGlobal Ethereum Foundation documentation](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation) and [Anon-RPC wallet guide](https://ethereum.github.io/anon-rpc/wallets/) describe the network integration used here.
