# QRAFT relayerless contract inventory

Browser → Nym Anon RPC → alternative mempool → EIP-8141 execution. No application backend signs or submits account setup or private payments.

Nine shared contracts. There is no separate bootstrap account.

| Contract | Address | Responsibility |
|---|---|---|
| `pool` | `0xbE1EeA2060D89b76f61aB5d24caeD53a49E3f18e` | Holds pooled ETH; verifies actions, consumes nullifiers and records encrypted outputs. |
| `proofVerifier` | `0x262238f463bdb3cb6BD2B39555a826fB44827075` | Checks Groth16 join/split proofs. Conventional BN254 cryptography, not PQ. |
| `hasher` | `0x88FeC5010ab3E7e8844ed18EF5726Dd02903e6c3` | Poseidon hashing for the commitment tree. |
| `proofAccount` | `0xD6F56672bA4996D39818Ac90fd1Fc3042d606fcb` | Shared keyless sender for private payments; validates the exact proof-authorized transaction. |
| `paymaster` | `0xc571C61dfcDC74ba507Ec8E4A54D2aA0Fc30c700` | Pays gas and funds the 0.012 ETH setup stake through a restricted one-time factory call. |
| `implementation` | `0x537EB0efbD082f2971513b73AE1a57578174020a` | ERC-8286 PQ public-account logic, including factory-only one-time staking. |
| `factory` | `0x1eFc9d5d88e927460f3D5b02863fb67BA928F866` | Checks PQ setup authorization, deploys deterministic accounts and stakes them using paymaster funds. |
| `validator` | `0x30955e8D50967FD7C7c341274D7A7e72B9ea09f8` | Validates account authorization using the configured ML-DSA verifier. |
| `walletVerifier` | `0x4EFEc12a8BD70a2D24F89622064ee083F7Ef0e9C` | Onchain ML-DSA-44 signature verification. |

Each user additionally has one deterministic public-account clone pointing to the implementation. The shared proof account has no signing key and does not custody user funds. The pool holds the ETH; receiving keys and spending secrets remain on the user’s device.

Network infrastructure, not QRAFT deployments: the EIP-8141 execution entry point, EIP-8250 nonce manager and alternative-mempool staking registry. Nym Anon RPC and the alternative mempool are network services, not pool contracts.

## Funding

The paymaster holds one budget for gas and the 0.012 ETH stake per new account. The factory can request stake funding only during its native setup execution frame, once per key commitment, for its canonical deployed account. Creation, funding and staking are atomic: a failed setup rolls them back. Users pay neither setup charge. The factory retains no setup funds.

Confirmed initial balance: 220.5 ETH, including a 220 ETH refill. See `private-direct-budgets.json`. This budget is finite; permissionless onboarding can exhaust its subsidy. Infrastructure initialization/funding is administrative, not a per-user backend transaction.

## Verification status

Contract compilation, 93 unit tests, build and local real-proof protocol tests pass. Real Nym initialization and pinned-contract reads pass. Factory-based account setup, deposit, private send and withdrawal all confirmed through the alternative mempool; all payment frames succeeded and gas was sponsored. The paymaster funded the setup stake while the user balance stayed unchanged. Unauthorized stake requests, a substituted key commitment and repeated setup were rejected. Native tests rejected modified nonce, fee, gas, state-gas and sponsor fields. See `private-pool-direct-live.json`. The full browser flow through real Nym also passed, including unified balance, a lost submission acknowledgement, reload reconciliation, recovery after clearing storage with the original passkey, and exact withdrawal payout/change. See `private-wallet-e2e-nym.json`. External payout verification uses an independent direct RPC read. Earlier carrier/relay receipts do not validate this deployment.

## Limits

Groth16 proofs remain conventional cryptography with development proving parameters. The node lacks a supported expiry-verifier predeploy, so expiry is checked during pool execution. A valid operation that expires or fails during execution may waste sponsor gas. Nym does not eliminate all timing or onchain correlation. No independent security audit or production readiness claim.

The Groth16 verifier uses fixed precompile gas allowances (EC multiplication 10,000; addition 1,000; pairing 200,000) so proof authorization does not execute the mempool-banned GAS opcode. Real-proof local tests verify these limits.
