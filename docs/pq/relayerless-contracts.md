# QRAFT relayerless contract inventory

Browser → Nym Anon RPC → alternative mempool → EIP-8141 execution. No application backend signs or submits account setup or private payments.

| Contract | Address | Responsibility |
|---|---|---|
| `pool` | `0x8A15B95e7174409F38b977f99a2a88Bb5dd8ce70` | Holds pooled ETH; verifies actions, consumes nullifiers and records encrypted outputs. |
| `proofVerifier` | `0xcABF33C15264d3561feFAa066523ec44B2679e00` | Checks Groth16 join/split proofs. Conventional BN254 cryptography, not PQ. |
| `hasher` | `0xCe6b2942731A39aFbC09641e03706B3aab57e0CC` | Poseidon hashing for the commitment tree. |
| `proofAccount` | `0x6f85fE27395f9347FBdaBE74Ef8800C98E2A83E1` | Shared keyless sender for private payments; validates the exact proof-authorized transaction. |
| `bootstrap` | `0x459ACe42519Fd2D8b4E3aFE843aC1f306fDcd85C` | Checks the new owner’s PQ signature, deploys their public account and sponsors its 0.012 ETH stake. |
| `paymaster` | `0x9751B7f9F83B3B396dB4b4520961D747e9362D92` | Pays gas for permitted account setup, deposits and proof-authorized payments. |
| `implementation` | `0x337e69016cBbed4Deb4b881a7107Cd1d5eF2fdea` | ERC-8286 PQ public-account logic, including restricted one-time sponsored staking. |
| `factory` | `0xB7908eD99D9CBcBA711a7708986819121B1172D0` | Deploys deterministic per-user public-account clones. |
| `validator` | `0x30955e8D50967FD7C7c341274D7A7e72B9ea09f8` | Validates account authorization using the configured ML-DSA verifier. |
| `walletVerifier` | `0x4EFEc12a8BD70a2D24F89622064ee083F7Ef0e9C` | Onchain ML-DSA-44 signature verification. |

Each user additionally has one deterministic public-account clone pointing to the implementation. The shared proof account has no signing key and does not custody user funds. The pool holds the ETH; receiving keys and spending secrets remain on the user’s device.

Network infrastructure, not QRAFT deployments: the EIP-8141 execution entry point, EIP-8250 nonce manager and alternative-mempool staking registry. Nym Anon RPC and the alternative mempool are network services, not pool contracts.

## Funding

The paymaster budget covers gas. The bootstrap budget separately pays 0.012 ETH per new public account for its network stake. Users do not pay either setup charge. Confirmed funding: 100 ETH added for gas and 120 ETH added for account stakes, in addition to base setup funding. See `private-direct-budgets.json` for the native funding receipt and exact balances at the recorded block. Both budgets are finite; permissionless onboarding can exhaust its allocated subsidy. Infrastructure initialization/funding is performed administratively, not once per user through a backend API.

## Verification status

Contract compilation, 93 unit tests, build and local real-proof protocol tests pass. Real Nym initialization and pinned-contract reads pass. Updated native account setup, deposit, private send and withdrawal all confirmed through the alternative mempool; all payment frames succeeded and gas was sponsored. Native tests rejected modified nonce, fee, gas, state-gas and sponsor fields. See `private-pool-direct-live.json`. The full browser flow through real Nym also passed, including unified balance, a lost submission acknowledgement, reload reconciliation, recovery after clearing storage with the original passkey, and exact withdrawal payout/change. See `private-wallet-e2e-nym.json`. External payout verification uses an independent direct RPC read. Earlier carrier/relay receipts do not validate this deployment.

## Limits

Groth16 proofs remain conventional cryptography with development proving parameters. The node lacks a supported expiry-verifier predeploy, so expiry is checked during pool execution. A valid operation that expires or fails during execution may waste sponsor gas. Nym does not eliminate all timing or onchain correlation. No independent security audit or production readiness claim.

The Groth16 verifier uses fixed precompile gas allowances (EC multiplication 10,000; addition 1,000; pairing 200,000) so proof authorization does not execute the mempool-banned GAS opcode. Real-proof local tests verify these limits.
