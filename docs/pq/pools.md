# Fixed native ETH pools

Choose **0.0001, 0.001, 0.01, or 0.1 ETH** below the displayed deposit value. Each amount has its own pool, note tree, and gas sponsor on **Ethrex chain 8141**. The account factory and transparent V5 verifier are shared.

The existing 0.0001 ETH pool remains in [pq-deployment.json](../../public/pq-deployment.json). Additional pools and their runtime/sponsor pins are in [pq-pools.json](../../public/pq-pools.json). The application accepts only registered pools on the pinned chain and genesis. A note binds the pool address and denomination; changing the amount or address does not migrate it.

| ETH | Pool | Paymaster |
| --- | --- | --- |
| 0.0001 | `0x66Ff71F39c9b6d46556769C479FFe29C0ad85854` | `0xEB3EE7B120452C83be9C5B3F30Cf5937748a1191` |
| 0.001 | `0xb67e8426D99b807065B7b6d0B35Bd403e35f5f2E` | `0x6BB762973ffC78d460ac1A3BA56c34BE49d31c48` |
| 0.01 | `0xd3437892c808A42a1531fD67A52F682890d12D31` | `0xe305e962496C9Df65f9e049Efd5AFF78d5ddF2C7` |
| 0.1 | `0x043bc5a5128D87137401299F9bC4605C912AB024` | `0x41bfBFa142173e4485a8bac4455C512756d43740` |

## Deposit and recover

Choose an amount before generating a note. Copy the note into a safely saved text file and acknowledge its backup before depositing. The selector is unavailable once a note is being used or a signed intent is unresolved. Importing a saved note selects its registered withdrawal pool automatically, independently of the current deposit selection.

The account must hold the principal; its pool's paymaster pays native frame gas. The local helper initially funds only 0.0001 test ETH. Transfer additional disposable test ETH to the PQ account for larger deposits. A wallet backup controls account authorization; the separate note controls the deposited value.

Each amount has a separate anonymity set. Four pools do not combine their deposit histories. The integration test reuses an account across pools and makes no unlinkability claim.

## Deployment and checks

Build the pinned frame-account dependencies and artifacts before deploying additional pools:

```sh
node packages/frame-account/scripts/build.mjs
node --experimental-strip-types scripts/deploy-pq-pools.mjs
node --experimental-strip-types scripts/deploy-pq-pools.mjs --broadcast
npm run doctor
```

The first deployment command estimates without broadcasting. The second creates three pool/sponsor pairs, funds each sponsor with 0.001 test ETH, checks constructor bindings and actual runtime hashes, and verifies exact deposit-value policy. It publishes registrations only after all checks pass. A durable journal under ignored `.local/qraft-fixed-pools` freezes signed transactions for reconciliation. All helper processes serialize access to the same gas-carrier lock; an interrupted owner requires reconciliation rather than lock deletion.

`doctor` verifies all four pools and their sponsor bindings. `scripts/test-pq-pools.ts` performs real native deposits, exact principal-debit checks, three-frame receipts, and note recovery using a protected disposable wallet. It explicitly uses direct RPC for diagnostics. Keep its protected notes and wallet under `.local/fixed-pools-live` to recover test deposits. Public evidence is in [pool-checks.json](pool-checks.json).

All four denominations also passed browser proof generation/local verification and independent native public-only export using separate synthetic one-leaf trees. Those synthetic proofs do not correspond to the funded integration deposits. These checks do not establish fresh end-to-end onchain withdrawals for all four pools. Browser proof verification, public native export, and complete onchain verification are distinct checks. The EF alternative mempool target remains chain 1337; these chain-8141 deployments do not prove sidecar admission. See [EF track status](ef-track.md).
