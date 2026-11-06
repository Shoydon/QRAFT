# QRAFT

Native ETH privacy pool on the EF alternative-mempool devnet, chain **1337**. Wallet authorization uses **ML-DSA-44**. Withdrawals use a compact **Groth16/BN254** proof generated locally in the browser. The proof and Poseidon note system are conventional cryptography, **not post-quantum**. The imported proving setup is for development, not production funds.

## Architecture

Five shared contracts: wallet signature verifier, withdrawal proof verifier, account factory, privacy pool and paymaster. Each wallet adds **one account contract**. Two wallets therefore require **seven active application contracts**. There are no public-key storage contracts, proof uploads, session contracts or per-proof deployments in the atomic flow.

A withdrawal is one native EIP-8141 transaction:

1. Account VERIFY frame checks the ML-DSA-44 signature over the native transaction digest.
2. Paymaster VERIFY frame checks the exact pool action and approves gas payment.
3. SENDER frame calls the pool; the pool verifies the proof, marks the nullifier spent and pays the recipient atomically.

The account commits to 20,544 bytes of public verification data, supplied in authorization calldata. Those bytes are derived from the 1,312-byte public key. The private seed is never deployed. The shared verifier includes Keccak internally and has no separately deployed permutation helper.

The browser stores wallet seeds encrypted with AES-GCM under a WebAuthn PRF-derived key. Reload stays locked until explicit unlock. Multiple wallets can be named. Private notes can be downloaded and pasted/imported for withdrawal. Any valid recipient, including an EOA, can receive ETH.

## Network and transport

- Execution RPC: `https://altmempool.forshtat.com`
- Alternative mempool: `https://altmempool.forshtat.com/rpc`
- Explorer: https://explorer.altmempool.wtf/
- Active contract addresses: [deployment manifest](public/atomic-deployment.json)

Browser chain reads and signed submissions use Nym Anon-RPC. This hides the browser IP from the destination RPC; it does not hide onchain addresses, values or transaction data. Worker discovery is a direct bootstrap request. Public wallet provisioning uses a funded server operator; it receives only the public key. All wallet creation and application transactions use native frames. Large shared infrastructure code deposits use native frames submitted directly to the execution RPC because their code-deposit reservation exceeds the sidecar cap; wallet creation, deposit and withdrawal use the actual alternative mempool.

## Verified flow

Live chain-1337 CLI test, real sidecar inclusion:

- [Deposit](https://explorer.altmempool.wtf/tx/0x38ff98c1a2bbc903f157ab9d083a47a8cb50b9bc7adb323d191939b948c07316): **3,659,009 gas**.
- [Atomic withdrawal](https://explorer.altmempool.wtf/tx/0x19f9ef5d4ffcb2342ca4828becb3ec8c9c631575e85541f122c9ba4424e791d7): **3,191,862 gas**, three successful frames, exact 0.0001 ETH payout, gas paid by the paymaster.
- [Public receipts and deployed inventory](docs/pq/atomic-live.json).
- [Local security tests](docs/pq/atomic-protocol-test.json): real proofs, invalid proof/context rejection, replay rejection, payout rollback.
- [Wallet verifier tests](docs/pq/atomic-verifier-test.json): SHAKE differential vectors, independent keys and malformed signatures.

See [feasibility and security tradeoffs](docs/pq/atomic-feasibility.md) and [application security](docs/pq/application-security.md). Testing is not an independent audit.

## Run

```sh
npm install
npm run prepare:proving
npm run dev
```

Use `http://localhost:3000` for passkeys. IP-address origins do not support wallet passkey registration. The funded devnet operator must be configured in `ATOMIC_OPERATOR_FILE` or `.local/alt-mempool-deployment/operator.json`, with mode 0600. Never commit its key. Deployment/staking requires funded devnet ETH; the paymaster sponsors gas, not deposit principal.

```sh
npm test
npm run check
node scripts/build-atomic-verifier.mjs
bun scripts/test-atomic-verifier.ts
node scripts/build-atomic.mjs
node --experimental-strip-types scripts/test-atomic-protocol.mjs
```

The native account/paymaster build requires the pinned EIP-8141 compiler described in `packages/frame-account/scripts/build.mjs`. Committed atomic artifacts support the app build; rebuild and compare them when changing Solidity.

Live scripts are explicitly state-changing and use ignored, private journals: `scripts/deploy-atomic.ts`, `scripts/test-atomic-live.ts` and `scripts/test-atomic-app.mjs`. Do not delete a pending signed journal or create a different nonce just because confirmation is slow.

## Historical recovery

`/pq` runs the V5 hiding-STARK application on chain 1337, including browser proof creation, local verification, public-proof publication and the complete staged on-chain verifier. These notes are incompatible with the atomic pool and are never relabeled or migrated silently. See [PQ setup](docs/pq/setup-1337.md) for operation and verification commands. The atomic application does not restart V5 proof jobs.
