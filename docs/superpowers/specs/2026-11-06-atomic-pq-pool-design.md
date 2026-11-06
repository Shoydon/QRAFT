# QRAFT: atomic withdrawal and a fixed contract architecture

Status: approved by the user; implementation and live end-to-end verification in progress. See docs/pq/atomic-feasibility.md for the authorized conventional-proof selection.

## Intent and agreed requirements

Replace the storage-heavy, staged withdrawal architecture with a pool call that verifies a proof and pays the recipient atomically. The reason for the redesign is actual gas consumption and deployment overhead, not merely hiding progress steps.

The user requires one account contract per wallet, one shared paymaster, and no contracts deployed per withdrawal proof. Separate shared verifiers for wallet signatures and withdrawal proofs are acceptable. Wallet authorization remains ML-DSA-44. A post-quantum withdrawal proof is preferred; a conventional ZK proof is an explicitly permitted fallback if a practical PQ implementation cannot be established. The user accepted a single-transaction withdrawal as the target.

Keep chain 1337, EIP-8141 native frame transactions, actual alternative-mempool admission, and Anon-RPC. Preserve eligibility evidence for the EF alternative-mempool, Anon-RPC, and CROPS tracks without guaranteeing an award or claiming security properties beyond the implementation.

## What is wrong with the current implementation

The active stack has 13 shared contracts, six contracts per wallet, and 55 storage-only contracts for the current withdrawal's 446,680 public bytes. The two-wallet test therefore involves 80 contracts, excluding network predeploys and older experiments.

The verifier executes 663 bounded operations: 87 transcript calls, one AIR preparation, 93 AIR batches, one quotient check, 41 claim projections, 320 input queries, and 120 FRI folds. Uploads and session authorization are additional transactions. Historical full-flow evidence reports approximately 6.43 billion combined gas. Current receipts include individual proof calls consuming about 13.4 million execution gas.

Live sidecar configuration reports a 25,000,000 total transaction/bundle gas cap. The execution block's 60,000,000 limit does not override the sidecar cap. Frame grouping reduces overhead but does not remove the proof computation. A local fork experiment eliminating a repeated sealed-blob hash saved about 8.7% for one AIR call; it is not evidence that this proof can fit in one transaction.

The old run was stopped. Its notes, signed journals, deployment evidence, and pending transaction identities must remain intact. It must not be represented as a completed chain-1337 withdrawal.

## Approaches considered and selection

### A. Compact PQ proof with atomic verification — preferred

Use an established hash-based/PQ proof construction with a concrete EVM verifier and browser-capable prover. Benchmark the complete withdrawal statement, not a toy hash or an isolated verifier fragment. Only choose it if complete verification, calldata, wallet authorization, sponsorship, and payout fit the real devnet limits and the security argument remains defensible.

Tradeoff: retains the desired application-level PQ scope, but suitable performance and deployability are not established yet. Do not invent a new cryptographic construction or reduce security parameters merely to obtain a passing gas estimate.

### B. Compact conventional ZK proof with PQ wallet authorization — authorized fallback

Retain ML-DSA-44 account authorization and replace the withdrawal proof with a compact conventional verifier. Inspect the repository's existing circuit/verifier as a candidate, not an automatically trusted or compatible component. Review statement binding, setup provenance, browser proving, and license requirements.

Tradeoff: a much more practical atomic-verification path, but the proof/pool must not be described as post-quantum. PQ wallet signatures do not make a pairing-based proof quantum-resistant. If the fallback also changes the note commitment/tree hash, document that additional limitation explicitly.

### C. Retain the staged V5 verifier and batch its transactions — rejected as the replacement

This remains useful historical evidence, but retains excessive computation, public-data deployment, and persistent sessions. It does not satisfy the requested architecture.

Selected direction: assess A first, with B as the permitted fallback. The feasibility report must identify examined candidates, measured limits, security assumptions, and the reason for selection. It must not claim that failure of the examined candidates proves no PQ solution exists anywhere.

## Proposed contract boundary

Target five shared application contracts, plus one deployed account per wallet:

1. Wallet factory: deterministically deploy a small standalone account; avoid an additional clone implementation contract.
2. Wallet-signature verifier: shared ML-DSA-44 verification.
3. Withdrawal-proof verifier: one shared proof verifier, with no verifier sessions or auxiliary data deployments.
4. Paymaster: sponsor allowed account operations with bounded gas/value/selector policies and the required sidecar staking.
5. Privacy pool: maintain commitments, accepted roots, spent nullifiers, denomination, and payout rules.

This is a feasibility target, not a verified count. Count every additional deployed helper or library explicitly. The current Keccak helper cannot be silently omitted from the count: its elimination or incorporation, and the resulting runtime size, are part of the wallet-verifier feasibility check. If this boundary cannot meet network bytecode/gas limits, report the conflict and revisit the design rather than disguising additional contracts behind one facade.

Network-owned nonce, staking, and deterministic-deployment predeploys are dependencies and must be listed separately. They are not contracts deployed for each user or proof. Solidity libraries compiled into a contract are not additional deployments; separately deployed libraries are.

## One account per wallet

Generate the keypair locally. Derive prepared public verification data locally and commit to its exact canonical bytes in the account configuration. Supply these public bytes with each authorization instead of deploying four rows and a descriptor.

The account/verifier checks the commitment, exact encoding and length, signature, and the signed transaction digest. Recovery independently recomputes the commitment from the public key and checks deployed account configuration. Bind the commitment to the chosen key format/algorithm version and use collision resistance appropriate to the stated PQ scope; do not downgrade the binding relative to the current account design.

This is an adaptation of storage and input handling, not a new signature algorithm. Preserve signature rejection checks and differential-test valid and invalid signatures against the reference implementation. Measure larger calldata, actual verification gas, runtime size, and account deployment state gas. The prepared data is public; never transmit the seed or private signing key.

Keep passkey-encrypted browser storage, user-initiated unlock, multiple named wallets, and optional encrypted backups. Importing a historical backup must never silently reinterpret its deployment or key format.

## Atomic deposit and withdrawal

Deposit: the account verifies its native authorization, the paymaster authorizes gas, and a SENDER frame calls the pool with the commitment and exact denomination. The wallet pays principal and the paymaster pays gas. No proof is required to deposit.

Withdrawal: generate and verify the proof locally, then submit one native frame transaction:

1. VERIFY: validate the account's ML-DSA authorization over the exact transaction.
2. VERIFY: validate paymaster sponsorship.
3. SENDER: execute the account's call to `pool.withdraw(proof, publicInputs)`.

Within that pool call, validate public inputs/root/expiry/nullifier, call the shared proof verifier, mark the nullifier spent, and transfer the exact payout. Any invalid proof, failed transfer, replay, or mismatched context reverts the withdrawal's state changes. No earlier transaction establishes partial proof acceptance. Signature/paymaster frame semantics remain subject to the native protocol; a reverted withdrawal can still cost gas.

The proof must bind note ownership/membership and nullifier derivation to the recipient, chain, pool, denomination/asset, fee policy, and expiry. The pool derives/checks the context independently. A proof cannot be replayed for another recipient, deployment, or amount. Use checks-effects-interactions and reentrancy protection where required.

A recipient may be an EOA or PQ account. The submitting PQ account and the recipient need not be identical. A note alone is the private withdrawal witness; the submitting wallet authorizes the native transaction. No mandatory link to the depositing account may be introduced.

Wallet creation also uses native frames through the alternative mempool. If sponsored counterfactual creation is not supported by the tested devnet, a narrowly scoped operator may submit the account-creation frame; disclose who pays. Do not reintroduce proof-upload or verification-orchestration services under that exception.

## Data and transport

Keep the witness and proving key material local. Send the public proof in the withdrawal calldata. Remove public-proof upload jobs, per-proof code storage, verification-session creation/attachment, and hundreds of helper transactions from the new path.

Use the real Anon-RPC path for user chain reads and sidecar submissions. Preserve worker hash verification and isolation, including the verified header compatibility fix. Document direct bootstrap traffic and any remaining provisioning service traffic. Neither anonymous transport nor a successful receipt guarantees practical anonymity.

Persist an exact signed intent before disclosure. Reconcile the same hash after an uncertain result; do not manufacture another nonce. A cancelled sidecar relay may retry the same signed bytes with a bounded policy. Require canonical receipts and successful frames/events before showing success.

## Feasibility gates and engineering decisions

The following are proposed engineering decisions, not claimed prior user requirements:

- Evaluate credible existing implementations against the full withdrawal circuit. Do not spend the project on a bespoke proof-system research effort.
- Hard gate: successful admission and inclusion within the live sidecar transaction cap, including execution/state budgets and intrinsic costs. Target at most 20 million reserved gas to leave margin; a measured exception below the hard cap must be documented.
- Record actual consumed execution/state/intrinsic gas separately from declared limits, and gas units separately from ETH fees. Low testnet gas prices do not make a billion-gas protocol efficient.
- Require bytecode-size compliance, supported precompiles, complete proof calldata within relay limits, and local browser proving without witness disclosure.
- Keep the existing PQ proof parameters/security argument unless replacing them with an independently justified construction. A conventional wrapper around a PQ proof does not preserve end-to-end PQ verification.
- If no examined PQ candidate meets these gates, choose the authorized conventional fallback and update every security claim and note/profile identifier. Do not quietly label it a PQ proof.

Exact proof library, safe compiler settings, Solidity organization, and UI component details are builder decisions supported by measurements. Do not promise a particular prover time or gas figure before benchmarking.

## Migration and user interface

Create a new explicit deployment/profile rather than modifying or upgrading the old pool's meaning. Preserve old deployments, notes, and journals for recovery. Do not auto-migrate funds or replay old notes on the replacement pool. Keep old recovery documentation separate from the new default flow; the old staged design must not remain a hidden fallback for new withdrawals.

The user sees local proof generation, transaction authorization/submission, and confirmation. Show the actual three frames and gas sponsor, with an explorer link on completion. Remove old session/upload progress and stale gas-payer or security labels from the replacement path.

## Acceptance evidence

- Explicit deployed contract inventory: fixed shared set, exactly one account per fresh wallet, no new contracts during proof generation/withdrawal.
- Two fresh accounts on chain 1337, a funded/staked paymaster, and the new pool/verifier.
- A real deposit from account A and one atomic sponsored withdrawal submitted by account B. Confirm exact pool and recipient balance deltas, successful native frames, and actual alternative-mempool inclusion.
- Invalid proof, altered recipient/context/root/nullifier, replay, wrong-key/public-data commitment, malformed signature, and failed payout tests. Failed withdrawal must not consume a note or transfer funds.
- Browser passkey/multiple-wallet checks, private-data leakage checks, and real Anon-RPC submission. Record any test harness provisioning exceptions explicitly.
- Proof bytes, shared runtime sizes, account deployment gas, and complete deposit/withdrawal gas breakdown with public receipt links.
- Build, type/lint and relevant tests pass. Fetch and safely integrate main before the authorized push; preserve unrelated work. No references to the other project in source or commit messages.

## Non-goals

No upgrades to the devnet's global limits, trusted operator approval of withdrawals, incomplete proof acceptance, weakened parameters without a security analysis, or claims of production readiness/end-to-end Internet PQ security. Historical successful tests are not evidence that the new design works.
