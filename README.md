# QRAFT

A private ETH wallet on the EF alternative-mempool devnet, chain **1337**. One unlocked balance, exact private payments, encrypted receiving, and withdrawal to any public address. Notes, proofs, input selection and change are wallet internals.

Wallet transactions are authorized with **ML-DSA-44** and receiving payloads are encrypted with **ML-KEM-768**. Private ownership is proved by a local **Groth16/BN254** circuit over a Poseidon tree. That proof system is conventional cryptography, so **this is not an end-to-end post-quantum payment system**. The proving parameters are a single-operator development setup, not a ceremony, and not for production funds.

## What the wallet does

- **Add ETH** — a public deposit into the pool. Incoming payments merge into one private balance.
- **Send privately** — an exact amount to another wallet's receiving address. Inputs are selected automatically and change returns privately.
- **Receive** — share a receiving address. Payments arrive encrypted and are discovered locally, including while the recipient was offline.
- **Withdraw** — native ETH to any public address, including an EOA.
- **Combine** — explicit consolidation of up to four smaller incoming payments into one spendable piece. The total does not change.
- **Recover** — one portable encrypted file restores spending ability and incoming funds, with the original passkey.

## Architecture

The pool is a four-input, two-output join/split circuit over a depth-20 Poseidon tree, with 128-bit wei values and fourteen public signals. Addresses and runtime hashes are pinned in the [deployment manifest](public/private-deployment.json): pool, proof verifier and Poseidon hasher, a narrowly scoped paymaster, and the shared ML-DSA wallet verifier, validator, account implementation and factory.

Every wallet action is one native EIP-8141 transaction with three frames:

1. Account VERIFY checks an ML-DSA-44 signature for public deposits, or the exact pool proof for private sends and withdrawals.
2. Paymaster VERIFY frame checks the exact pool action and approves gas payment.
3. SENDER frame calls the pool, which verifies the proof, spends nullifiers and pays out atomically.

Public deposits use the user's own account. Private sends and withdrawals name a shared proof-authorized contract as the sender, without a shared signing key. The browser builds and submits every payment through Nym Anon RPC. No per-payment contract is deployed and no application relayer is used.

The factory checks the user's PQ signature and deploys their public account directly. The paymaster funds both the 0.012 ETH account stake and setup gas; there is no separate bootstrap account. User ETH is not debited for setup. No per-user operator transaction is needed.

The browser holds wallet seeds encrypted with AES-GCM under a WebAuthn PRF-derived key, and a reload stays locked until explicit unlock. Signing, spending and receiving keys derive from one master secret, so there is no separate viewing key to back up.

## Network and transport

- Execution RPC: `https://altmempool.forshtat.com`
- Alternative mempool: `https://altmempool.forshtat.com/rpc`
- Explorer: https://explorer.altmempool.wtf/

Chain reads, account setup, deposits, private sends and withdrawals use Nym Anon RPC. There is no application HTTPS relayer and no direct-network fallback. The browser retains the exact raw transaction before submitting it and reconciles its canonical settlement before retrying. Public-balance queries occur only for public-account views and deposits, not automatically before private sends.

Nym hides the browser IP from the destination RPC; this does not establish protection from every traffic-correlation observer. Worker discovery is a direct bootstrap request, and the separately provided faucet is a public funding service. Public deposit and withdrawal amounts and addresses remain visible.

The proof account pins the exact frame shape, fees, sponsor and gas budgets. Its nonce key is the action digest with sequence zero, allowing independent private operations without a server nonce allocator. The factory uses a signed per-key nonce sequence, permitting recovery after a failed setup. Pool expiry is enforced during execution because the deployed node has no supported expiry-verifier predeploy. An expired or otherwise failing operation can waste sponsored gas; sponsorship is finite and not abuse-proof.

See [the contract inventory](docs/pq/relayerless-contracts.md) for deployed addresses and responsibilities.

## Relayerless verification

The [native transaction run](docs/pq/private-pool-direct-live.json) confirms direct factory setup with paymaster-funded stake and no user charge, deposit, private send and withdrawal through the alternative mempool. All three payment frames succeeded with the pinned paymaster paying gas. Modified nonce, fee, execution-gas, state-gas and sponsor fields were rejected in native simulation. The [full browser run through real Nym](docs/pq/private-wallet-e2e-nym.json) also passed: two deposits combined into one balance, private send with lost-acknowledgement recovery, restore after clearing browser storage with the original passkey, and withdrawal with exact payout and change.

## Earlier verified flow (before relayer removal)

Live chain-1337 runs against the real sidecar, [full receipts here](docs/pq/private-pool-live.json). Each action landed three successful frames with gas paid by the paymaster:

| Action | Gas |
|---|---|
| [Add ETH](https://explorer.altmempool.wtf/tx/0x280ced8f3ac4b2d38da0456ceb0d3c5aa2958a63fa71acdd392c858145403663) | 4,344,327 |
| [Private send](https://explorer.altmempool.wtf/tx/0xbd8a6e8604b9e0073bc8b68fe5697142770cf0b41633eba99cdce7e22e7a22f0) | 5,188,516 |
| [Withdraw](https://explorer.altmempool.wtf/tx/0x486878ec1c60d4f21df49b7577f05c97e56697a26dff71c9303d21f16b980793) | 4,500,838 |

[End-to-end wallet test](docs/pq/private-wallet-e2e.json): a recipient created while offline, two deposits displayed as one 0.00004 ETH balance, a private payment confirmed after a lost response and reload, sender change exactly 0.00001 ETH, a cleared browser restoring both payment and receiving identity from the original passkey, and a confirmed 0.00001 ETH withdrawal. That run injects direct reads while using the real provisioning API, shared relay and native alternative-mempool payments.

[Browser checks](docs/pq/private-wallet-browser.json): passkey enrolment, encrypted backup, reload unlock, stable receiving address, cross-tab locking, archived journals, recovery quarantine, and local proof generation in roughly five seconds. That run injects a direct test RPC and does not exercise Nym; the [Nym transport check](docs/pq/private-wallet-nym.json) is recorded separately.

[Protocol tests](docs/pq/private-pool-local.json) cover real proofs and rejection paths. See the [implementation guide](docs/pq/private-wallet.md), the [approved design](docs/superpowers/specs/2026-11-07-private-wallet-design.md) and [application security](docs/pq/application-security.md). Testing is not an independent audit, and devnet inclusion is not finality.

## Run

```sh
npm install
npm run dev
```

Use `http://localhost:3000` for passkeys. IP-address origins do not support wallet passkey registration.

Building the circuit requires an isolated toolchain:

```sh
npm install --prefix .local/private-wallet-tools --no-audit --no-fund circom2@0.2.23 circomlib@2.0.5
npm run private:build
node scripts/check-private-artifacts.mjs
```

`public/private-proving/manifest.json` records source and R1CS hashes, compiler version and artifact hashes. The checked-in proving key and verifier belong to the current deployment; a changed circuit requires an explicit new development setup and redeployment. Never keep an old verifier address against new parameters.

```sh
npm test
npm run check
npm run test:private:protocol
npm run test:private:browser
npm run test:private:e2e
```

Deployment targets EF devnet 1337 only, and uses the mode-0600 operator file under `.local/alt-mempool-deployment/`. Never commit its key.

```sh
bun scripts/deploy-private-pool.ts
bun scripts/setup-private-direct.ts --execution-bootstrap
```

Live scripts are explicitly state-changing and use ignored, private journals. Do not delete a pending signed journal or create a different nonce because confirmation is slow.

## Earlier applications

`/pq` runs the V5 hiding-STARK application on chain 1337: browser proof creation, local verification, public-proof publication and the complete staged onchain verifier. Those notes belong to a different pool, are incompatible with the private wallet, and are never relabelled or migrated silently. See [PQ setup](docs/pq/setup-1337.md).

The preceding fixed-value atomic pool is recorded in [public receipts and deployed inventory](docs/pq/atomic-live.json), with [protocol](docs/pq/atomic-protocol-test.json) and [wallet verifier](docs/pq/atomic-verifier-test.json) tests, and [feasibility and security tradeoffs](docs/pq/atomic-feasibility.md). Its contracts remain pinned in [atomic-deployment.json](public/atomic-deployment.json); the shared ML-DSA account infrastructure carried forward into the private wallet.
