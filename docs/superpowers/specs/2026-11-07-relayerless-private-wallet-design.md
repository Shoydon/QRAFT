# Relayerless QRAFT private payments

User requirement: no application relayer; browser submits EIP-8141 through Nym Anon RPC. Redeployment is allowed and old pools need not remain compatible. User approved this direction in conversation.

## Approach

Personal-account submission exposes a stable public account on private payments. Keeping a shared backend signer violates the requirement. Use a dedicated shared onchain account whose execution approval is based on the exact pool proof, with no signing key or server. This account is a validator, not a forwarding service. Sender-independent private spending is already authorized by the pool proof.

## Private transaction

1. Browser constructs encrypted outputs and the Groth16 proof locally.
2. Three frames: proof-account VERIFY; paymaster VERIFY; pool SENDER.
3. Account enforces exact shape, bounded fees/gas, no extra signatures/blobs/value and a nonce key derived from the action digest with sequence zero. This avoids a backend nonce allocator; deployed keyed-nonce and admission behavior must be tested.
4. Account validates all pool preconditions and proof before execution approval. Pool repeats validation when spending nullifiers and creating outputs/paying withdrawals.
5. Paymaster sponsors only the pinned account/action shape. Replay and altered-output/recipient/expiry attacks must fail before sponsorship.
6. Browser journals exact raw bytes/hash before broadcast, reuses them on retry and reconciles canonical settlement. No direct-network fallback.

## Public account provisioning

The existing /api/atomic/wallet uses a server operator to create and stake accounts. That dependency must also be replaced or explicitly reported as unresolved before calling the application relayerless. Investigate browser-only account deployment against the deployed alternative-mempool staking/admission rules. Operator deployment and funding of shared infrastructure is administration, not per-user transaction relaying.

## Contracts

Existing pool, Groth16 verifier and Poseidon hasher; new proof-authorized account; revised paymaster; public ERC-8286 PQ account implementation, validator, ML-DSA verifier and factory. Final inventory depends on the provisioning solution and must be reported from the deployed manifest, not this preliminary list.

## Security and validation

No new private spending keys. PQ account keys still authorize public operations; private spending proofs remain conventional Groth16. Nym does not prove resistance to every network correlation attack. Sponsor funds are finite and permissionless sponsorship can be abused; do not claim production readiness.

Validate contract rejection cases, actual native receipts, browser deposit/send/receive/withdraw including lost response, and actual Nym transport. Do not mark network E2E complete using injected direct reads. Update UI, docs and pitch deck only to confirmed behavior.

## Final setup decision

User requested sponsored onboarding. The bootstrap contract holds an explicit finite onboarding budget and forwards exactly 0.012 ETH to each newly authorized account’s staking function. It never debits the user’s public balance. The paymaster is funded separately for gas. Both setup and private transactions are browser-submitted through Nym. Setup uses a per-key signed nonce sequence; private operations use action-derived nonce keys with sequence zero and exact immutable frame/fee budgets. Prefix validation omits unsupported time introspection; execution checks expiry. Account-code inspection happens in setup execution because the sidecar rejects EXTCODESIZE on undeployed addresses during validation.
