# Qraft private wallet: architecture and user experience

Date: 2026-11-07. User selected native Qraft, ETH first, local Groth16 proofs, PQ wallet and receiving encryption. User explicitly approved development after architecture. Fresh devnet deployment; no migrations or backward-compatibility requirement. Written flows only, no browser mockup requested. Technical choices below are engineering proposals under that authorization, not claims of deployed functionality.

## 1. Product outcome

Qraft becomes a private ETH wallet. Users unlock once, see their available private balance, receive while offline, send an arbitrary amount, and withdraw to a public address. Notes, proofs, input selection, merging and change are wallet internals. One portable recovery backup restores the wallet and incoming funds without depending on the original browser or passkey domain.

V1 includes add funds, private send, private receive, withdrawal, automatic change, explicit consolidation when needed, current activity status, recovery, and bounded sponsored submission. It excludes ERC-20s, swaps, bridges, arbitrary contract calls, auditor escrow, screening, public usernames, cloud custody and end-to-end PQ claims. It is an experimental devnet wallet.

## 2. Approaches and decision

1. **Selected: native Qraft pool.** Keep chain 1337, the existing ERC-8286/ML-DSA work and Anon-RPC. Build a variable-value note protocol with local proving. More protocol work, but preserves Qraft's stack and EF demonstration.
2. **Not selected: STRK20 integration.** Reuse Starknet pool/wallet APIs and native proof verification. Changes chains, account model, proving architecture and trust assumptions. This is not a Solidity library we can import into the EF devnet.

Within option 1, use a bounded join/split circuit and encrypted output feed. Do not attempt a general Cairo-like virtual execution proof or a full channels/indexer service in the first version. This trades pool-wide scanning cost for a smaller, locally verifiable devnet implementation. Preserve replaceable discovery interfaces for later scaling.

## 3. What the STRK20 specifications inform

These are references, not claimed compatibility:

- [Overview](https://strk20.starknet.io/docs/what-is-strk20): variable-value notes, automatic change, private transfers and public deposit/withdrawal boundaries. Adopt the wallet experience; use Qraft's own proof and account design.
- [Wallet API](https://strk20.starknet.io/docs/starknet-wallet-api/overview): wallet owns keys, discovery, proving and submission. Adopt the same separation between UI intentions and protocol machinery.
- [Viewing keys](https://strk20.starknet.io/docs/viewing-keys): account keys and viewing material are separate; exact recovery matters. STRK20 uses STARK-curve ECDH and auditor escrow. Qraft proposes ML-KEM encryption and no auditor copy.
- [Channels](https://strk20.starknet.io/docs/channels-and-subchannels): directional channels and token subchannels reduce scanning. Qraft V1 instead scans encrypted outputs locally. Do not claim STRK20's per-user scan scaling.
- [Actions and proofs](https://strk20.starknet.io/docs/actions-and-proofs): private actions conserve value and bind proof to exact execution. Qraft uses a dedicated circuit rather than virtual Starknet execution.
- [SDK getting started](https://strk20.starknet.io/docs/sdk/getting-started) and [proving configuration](https://strk20.starknet.io/docs/sdk/proving-config): discovery and proving must agree on a state snapshot. Do not copy Starknet's ten-block maturity rule onto this devnet without evidence.
- [SDK source](https://github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md): automatic note selection, explicit surplus/change, rebuildable private state and distinct speculative balances. Adopt rebuildability and explicit pending state; do not pretend devnet inclusion is finality.

## 4. Component architecture

UI -> browser WalletEngine -> encrypted vault + discovery worker + transaction planner + prover worker -> submission adapter -> chain.

Contracts: new PrivatePool, new JoinSplitVerifier, Poseidon hashing implementation, existing/shared ML-DSA verifier and modular account infrastructure, new narrowly scoped sponsor. Public deposits use the user's account. Private transfers and withdrawals use a shared relay account whose identity is independent of the depositor. No circuit/verifier/proof-specific contracts are deployed per payment.

Browser layers:

- Vault: create/unlock/lock/recover, domain-separated deterministic keys, authenticated encrypted local persistence.
- Discovery: reconstruct commitment tree, decrypt outputs, validate payloads, calculate nullifiers, reconcile pending/spent/reorged notes.
- Planner: parse ETH exactly as bigint wei, validate recipient, reserve inputs, select notes, calculate change, prepare immutable intent.
- Prover: worker-only witness handling, pinned artifacts, generate and locally verify proof and public signals.
- Submission: send public shield transactions or proof requests to the HTTPS shared relay; reconcile by action digest/nullifiers and actual receipts.
- Engine: subscribable state independent of React; UI never orchestrates protocol steps directly.

## 5. Key model and recovery

A new random 256-bit master recovery secret derives independent secrets with HKDF and versioned domain labels. Never derive secrets from a public signature or passkey credential identifier.

| Branch | Purpose |
| --- | --- |
| ML-DSA-44 seed | Account transaction authorization |
| ML-KEM-768 key-generation seed | Receiving/encryption keypair; encapsulated secret feeds HKDF + AES-256-GCM |
| Private spending secret | Field-safe secret whose Poseidon commitment is embedded in notes and receiving descriptors |

The circuit proves knowledge of the spending-secret preimage. It does **not** verify ML-DSA inside Groth16. ML-DSA authorizes account/carrier transactions; note ownership is a separate hash-preimage relation proved with conventional Groth16. Therefore PQ account authorization and PQ note encryption do not make pool soundness, anonymity or the whole environment PQ-secure.

The receiving decryption key cannot spend: decrypted payloads contain amount, note randomness and public owner commitment, never the spending secret. V1 offers no shareable full view-only wallet. A receiving key alone may discover receipts but cannot necessarily identify every later spend; a full viewing/nullifier design is a separate feature. Avoid calling a receive-only export a complete balance audit key.

Passkey PRF protects local vault unlock. A portable recovery package must work without that credential or original domain: version, chain/genesis/pool descriptor, master secret and derivation version, encrypted with a user-controlled recovery password using a pinned memory-hard KDF and AES-GCM. Password unlock restores keys and rewraps them under a new passkey. Backup export/import is round-trip tested before funds are accepted. Contact names, outgoing memos and UI preferences are not guaranteed recoverable from the seed alone; explain this in advanced recovery details. Never put secrets in URLs, logs, analytics or error reports.

## 6. Private address and encrypted delivery

A versioned private address descriptor contains network/pool identity, the public spending commitment, and ML-KEM public receiving key, with a checksum and strict size/encoding validation. It is distinct from an EVM 0x address. V1 favors a copyable complete descriptor and downloadable receiving card. ML-KEM keys are large: QR representation must be tested on actual phone cameras and fall back to a receiving card rather than a server alias. Never silently truncate the public key or resolve it through a mutable unauthenticated directory.

For each output the sender creates fresh randomness, computes its commitment, encapsulates to the recipient's receiving key, derives an AEAD key and encrypts a fixed-size payload. Associated data binds chain, genesis/pool version, output commitment and envelope version. Ciphertexts appear in canonical pool events and their hashes are bound to the proven action. The recipient independently decrypts, range-checks, recomputes commitment and checks owner before crediting a note.

Malformed encrypted outputs are not credited. The proof does not prove correct ML-KEM/AES encryption: a malicious payer can burn their own value by constructing an unreadable output. The honest sender validates both output payloads locally before proving, and the recipient never trusts a sender screenshot as receipt.

Do not assume KEM confidentiality establishes recipient/key anonymity. No recipient identifier or public receiving key is emitted, but recipient indistinguishability of the envelope needs explicit analysis. Treat broad sender/recipient anonymity claims as a review gate. Sender knows the payment they made; network timing and the public edges remain observable.

## 7. Note and proof specification

ETH-only notes contain protocol domain, owner commitment, amount in wei and independent note randomness. Amounts use unsigned 128-bit range checks. All hashes have disjoint domain tags; chain/genesis/pool binding is included through canonical digest limbs or field-safe domain constants. Do not reduce a 256-bit authorization digest into one BN254 field element.

Proposed circuit shape: four input slots and two output slots, with zero-value dummy slots and explicit Boolean activation. Same public shape for ordinary transfers and self-consolidation. A single proof handles zero-input shield, ordinary send, merge and withdraw according to the operation kind. Deployment benchmarks may require reducing input count; record any deviation rather than silently weakening constraints.

Private witnesses: input amounts, randomness, owner spending secret, Merkle paths; output amounts, randomness, owner commitments. Public data: accepted root, input nullifiers, output commitments, public deposit amount, public withdrawal amount/recipient, operation kind and two 128-bit action-digest limbs. Private input/output amounts are never exposed as public signals.

Required constraints:

1. Active inputs belong to the accepted tree; owner = H(spending secret); note commitment recomputes correctly.
2. Nullifiers bind the input commitment and spending secret with a separate domain. Duplicate active inputs/nullifiers are rejected; dummy nullifiers use a reserved value and cannot consume real notes.
3. Active outputs have positive bounded amounts and valid field values. Dummy outputs are precisely defined; they must never create spendable value.
4. sum(inputs) + public deposit = sum(outputs) + public withdrawal. Intermediate sums are bounded below the field modulus; no modular overflow creates money.
5. Operation constraints: shield has no spent inputs or withdrawal; transfer/merge has no public in/out value; withdraw has no public deposit and binds exact recipient. No arbitrary external call or fee output in V1.
6. The proof is inseparable from ciphertext hashes, ordered commitments/nullifiers, action kind, deployment domain, expiry and public withdrawal fields through the action digest. Every public signal is constrained. Contract computes the digest from actual calldata.

Contract checks: proof validity, root membership in retained history, nullifiers unused and distinct, commitment uniqueness, expected msg.value, bounded envelope sizes, expiry, tree capacity and payout success. Validate all conditions before external calls; mark spent and append outputs atomically; use non-reentrancy; payout failure reverts the action. Bind to operation, chain and deployed pool to prevent cross-context replay.

Tree target: depth 20, fixed for this circuit version, with append-only output leaves and reconstructable event indices. Reserve enough space for both outputs before consuming inputs. Capacity limits and root-retention rules are explicit; transfers also consume tree slots. Keep all accepted roots for the devnet MVP, reconciled against canonical chain history. No silent tree rollover or resetting live state.

## 8. Balance, selection and consolidation

Balance is computed from valid decrypted canonical notes, minus spent nullifiers and local pending reservations. Show available as the primary number; pending incoming and pending outgoing are separate. Never sum unverified indexer claims. Stale cached balance carries a syncing indicator and spending is disabled until reconciled.

Selection prefers the smallest number of sufficient mature inputs, then minimal change, with deterministic tie-breaking. Lock selected notes across tabs using browser coordination and a durable intent journal. Chain nullifier checks remain authoritative across devices.

If more than four notes are necessary, propose a finite merge plan that combines up to four into one self-owned note until the payment fits. Explain once: "This payment needs a balance update first. Qraft will complete N transactions." No invisible spend, no claim of one atomic transaction across merges. Resume from confirmed steps. Consolidation leaks batching/timing and does not improve privacy automatically. No idle/background consolidation without an approved action.

## 9. Discovery and state recovery

V1 consumes the whole pool output event stream through Anon-RPC, verifies ordered leaf indices, reconstructs the Merkle root, and decrypts locally in a worker. Fetch spent-nullifier events in batches rather than querying per-user note identifiers. Use a consistent block snapshot for tree, notes and proof input. Keep a local encrypted rebuildable cache keyed by genesis, pool and block hash.

Track block hashes; on a detected reorg rewind to the last common checkpoint and reconstruct. Pending outgoing notes remain reserved while the outcome is unknown. Reorged received value returns to pending/unavailable. Each wallet has a single write coordinator and cross-tab locks; multi-device conflicts are surfaced without duplicate spending.

Proof from an older accepted root is allowed if inputs remain canonical/unspent; a reorg that removes the root requires re-proving. Confirmation depth is a deployment parameter (initial devnet proposal: two blocks), labelled "confirmed on devnet," never finalized. Pending receipts can appear sooner but are not available to spend. Benchmark scanning/ML-KEM trial decryption before advertising large-history support.

## 10. Submission and sponsorship

Shield: user's PQ ERC-8286 account sends ETH into the pool, with bounded sponsored gas. Depositor and amount are public.

Send/withdraw: browser creates and locally verifies proof, then supplies only public proof/calldata to a shared relay. Relay's independent PQ account signs carrier frames; sponsor approves only exact new pool actions and measured budgets. No user's account signature, account address, receiving key or viewing key is required by the relay endpoint. Never imply the relay's PQ signature proves the user's private ownership.

The relay is an availability service, not custodian: it cannot alter destinations/outputs, forge ownership or move funds without a valid proof. It can correlate requests, censor or delay. Disclose direct network exposure until the relay request itself is verified through an anonymizing transport; anonymous chain reads alone do not anonymize a direct relay API. Do not claim complete anonymous transport if that path is unavailable. Allow alternate configured relays with the same proof; never silently fall back to the user's public account.

Persist an idempotent request keyed by the action digest. Serialize or correctly allocate keyed carrier nonces; retain exact signed bytes across retries. Check receipt, pool event and nullifiers after timeouts before replacing anything. A new proof after expiry requires fresh reconciliation and an explicit continuation of the same user intent.

Sponsor caps gas, maximum fee, calldata, pool address, selectors and operation shape. Per-relay admission limits and queue capacity mitigate repeated invalid/reverting proofs. Preflight proof and spent state before signing; acknowledge races and failed gas costs. Never accept arbitrary target calls under the pool sponsorship policy.

## 11. Written user flows

### First visit

One promise: "Your ETH, privately." Primary action: Create wallet. Show a small explicit devnet label. Create keys locally, set passkey, export portable recovery backup, verify re-import, then open wallet. Do not expose three key-generation steps or module names. Provision public account when funding requires it; receiving does not require an EVM account deployment in this architecture.

### Home

One large available private ETH amount, secondary public ETH balance where relevant, and actions Send, Receive, Add funds, Withdraw. Activity is an ordered list, not nested cards. Show empty-state guidance instead of a fake zero balance during discovery. Keep protocol details behind an inspect panel.

Use existing warm-paper/ink typography and spectral hairline. Strong spacing, clear amounts, excellent keyboard support and reduced-motion behavior. No neon dashboard, decorative security badges, invented anonymity percentage or fake live metrics. Motion only communicates state transitions; confirmed credit animates once, never on every rescan.

### Add funds

Enter ETH amount -> show public source, private destination, exact amount, sponsorship status and "Deposits are visible onchain" -> confirm -> prepare/prove locally -> submit -> pending -> confirmed balance credit. Max respects source balance; gas sponsorship never implies free principal. Repeated click cannot duplicate the intent. Insufficient public balance explains the funding requirement without a fabricated faucet success.

### Receive

Open receiving card -> copy private address or save card -> sender pays -> activity appears automatically after discovery. Recipient may be offline. No note import or claim transaction. Show QR only if payload fits and is practically scannable; otherwise clearly offer file/copy. A public EVM address is not a private receiving address.

### Send

Paste receiving descriptor -> locally validate network/checksum/key format -> enter amount -> review recipient fingerprint, amount and remaining balance -> confirm once -> wallet selects inputs and change -> locally proves -> relay submits -> confirmed. Advanced details expose proof profile, sponsorship and explorer receipt. Wrong-network or public addresses fail before proof generation, with a separate explicit Withdraw route. No mutable remote name lookup substitutes for recipient verification.

Progress is real stages: Preparing payment, Proving on this device, Submitting, Waiting for confirmation, Confirmed. No fabricated percentage or guaranteed timer. UI remains responsive; proof cancellation before submission releases reservations, while post-submission close merely hides progress and does not cancel funds movement. Persist public intent data and encrypted note reservations before leaving the page; warn if closing would lose an unfinished proof.

### Withdraw

Public address + amount -> review exact payout and "Recipient and amount become public" -> confirm -> same proof lifecycle -> exact public payout and private change. Validate recipient and show checksum/fingerprint. Copying a private address here produces an actionable error. All funds/Max handles spendable inputs and potential consolidation.

### Activity

Types: Added funds, Sent privately, Received privately, Withdrawn, Balance update. States: preparing, awaiting submission, pending, confirmed, outcome unknown, failed, reorged. Never show unknown as failed. Details include local labels, amount when known, timestamps, action ID and explorer link. Incoming sender identity is not authenticated by an arbitrary memo; do not claim a named sender without an authenticated scheme. Historical outgoing labels may be local-only after recovery.

### Recovery

Import portable backup -> decrypt locally -> recreate exact keys -> register a new passkey -> scan chain -> show recovered spendable balance and scan progress -> reconcile pending nullifiers. Wrong password is distinct from incompatible pool/genesis. Original domain or provisioning server is not needed to recover keys. Prove this by restoring into a clean browser context, not by reloading localStorage.

### Failures that must feel deliberate

- Network unavailable: retain previous balance with stale timestamp; pause spending; do not show zero.
- Sponsor unavailable: retain intent, say gas sponsorship is unavailable, retry same intent.
- RPC outcome unknown: show checking confirmation and prevent conflicting spends.
- Spent on another device: refresh notes, explain balance changed, request review if payment funding changed.
- Malformed incoming ciphertext: quarantine silently in advanced diagnostics; never increase balance.
- Insufficient notes within input limit: explain consolidation count before starting.
- Locked wallet: stop decryption/proving and clear worker secrets; public receipt reconciliation may continue.

## 12. Security and feasibility gates

This is new cryptographic protocol work. Required before calling it working: real proof generation, verification and rejection tests; independent architecture review; reproducible artifact generation/provenance; no weak proving parameters; honest trusted-setup disclosure. Browser proving time, memory, circuit input count, ML-KEM scan cost, envelope size and live gas are measured, not estimated as promises.

Required negative cases: wrong owner, copied ciphertext with changed commitment, inflation/underflow/field wrap, repeated inputs, spent notes, wrong chain/pool/action, output substitution, expiry, malformed recipient/envelopes, payout reversion, interrupted submission, cross-tab races, restored wallet discovery and reorg reconciliation. ML-KEM confidentiality is not a proof of anonymous recipient selection. Shared relay availability and traffic correlation remain stated trust boundaries.

## 13. Implementation map and acceptance

New protocol area under `packages/private-pool/`; browser engine under `src/lib/private-wallet/`; app UI `src/components/PrivateWalletApp.tsx`; new typed public deployment manifest and pinned browser artifacts. Preserve unrelated working-tree changes. Update product copy to the actual new security scope. No old-note migration code is required.

Acceptance demo: create Alice/Bob/Carol, back up each once, Alice shields 0.004 ETH across multiple deposits, sends Bob 0.0015 ETH with change, Bob sends Carol a smaller amount while Carol is offline, Carol restores from backup on a clean browser and sees funds, Carol withdraws a partial amount. Demonstrate proof-bound outputs, blocked double spend, and reconciliation after a dropped response. Record browser measurements, deployed addresses, sidecar-admitted hashes and exact balances. Existing pool receipts are not evidence for this flow.

The plan proceeds from executable protocol invariants to wallet engine to UI to real devnet integration. No success toast without confirmed receipt checks; no simulated balances presented as live; no production-readiness or end-to-end PQ claim.

## 14. Builder review resolutions

The independent builder review identified schema precision, in-flight recovery, relay durability and feasibility as required decisions. Resolve as follows:

- Canonical V1 hash schema: `owner = Poseidon2(1, spendingSecret)`; `commitment = Poseidon5(2, domainField, owner, amount, rho)`; `nullifier = Poseidon3(3, spendingSecret, commitment)`. Domain field is Keccak of ABI-encoded protocol tag, chain ID, genesis hash and pool address, reduced modulo BN254 solely as a fixed domain identifier. Authorization digests retain two 128-bit limbs. Tree interior hashing uses Poseidon2 and a pinned empty leaf.
- Public-signal order: root, domain, kind, deposit, withdrawal, recipient, four nullifiers, two commitments, digestHi, digestLo. Kind 0 is shield, 1 private send/merge, 2 withdraw. Inactive inputs have zero amount and zero nullifier; gated membership imposes no real-leaf requirement. Zero-amount outputs have commitment zero and empty envelope and are not appended. Active amounts are strictly positive; input/output owner and randomness are field-checked. All conditions are encoded identically in TS, Circom and Solidity.
- Proof expiry is at most five minutes from construction; pool enforces expiry. On fresh recovery, warn that an earlier pending payment may still settle; apply a five-minute outgoing-spend quarantine while reconciling canonical nullifiers. Within the normal session, persist digest, expiry, reserved input commitments/nullifiers and transaction identity before submission. A timeout never releases inputs; after expiry, query canonical nullifiers and receipts before release. An old proof cannot be submitted after expiry, although a transaction included before expiry may be discovered later.
- V1 relay transport is direct HTTPS to the app's relay API. It sees IP/request timing and public proof data; Anon-RPC protects chain reads, not this request. Remove any anonymous-relay claim from UI. The relay is single-process initially, with filesystem exclusive lock and durable request/signed-transaction journals; deployment docs must forbid multiple independent writers to the same carrier account. Restart replays the same journal before allocating a new nonce.
- First gate: compile circuit; generate pinned development proving artifacts with adequate constraint capacity; run real local shield/join-split/withdraw proofs; measure browser prove and native frame admission before freezing sponsor budgets or advertising speed. No weakening constraints or substituting a mock verifier.

## 15. Implemented V1 decisions and evidence

The core wallet is implemented and the fresh deployment is pinned in `public/private-deployment.json`. Build/run instructions, trust boundaries and verification commands are in [the implementation guide](../../pq/private-wallet.md).

- The compiled circuit has 51,316 constraints. Its four-input/two-output shape fits power-16 development parameters. The local browser test measured approximately 5.2 seconds for a proof on the development machine; this is not a mobile-performance promise.
- The selector uses the smallest sufficient single payment when possible, otherwise the largest available payments first to minimize input count. It does not solve an exhaustive minimum-change subset search.
- The Combine action reviews and settles one combination of up to four payments at a time. Larger fragmented balances can require repeating it; unattended multi-step combination is not implemented.
- The shipped activity surface shows current operation state, pending reservations and the latest confirmed transaction link. A full historical activity feed, local contact labels, and a Max shortcut remain follow-up UI work; they are not required to recover or spend the balance.
- Recovery works both on a fresh device and over a local vault whose passkey is lost. Replacement archives the old encrypted intent and applies the same chain-time quarantine before spending.
- Settlement discovery indexes action IDs, so an old completed payment can be reconciled from canonical events even when its relay response and transaction hash were lost. Successful confirmation still checks exact settlement, sponsor, native receipt and block depth.
- A failed public payout was tested to revert the entire state transition. Wrong owner/root, inflation, overflowing amounts, zero owner/randomness, altered public inputs/calldata and replay were rejected in real-proof tests.
- The production-browser test confirmed two deposits as one balance, a payment funded by both deposits with exact change, safe recovery after a dropped relay response/reload, offline receiving, fresh-device recovery and an exact partial withdrawal. The evidence distinguishes injected test reads from the separate real-Nym checks.

The independent builder review was completed, and its receipt binding, expired-intent recovery, crash-lock, passkey replacement, decimal precision and backup verification findings were addressed. These checks are development evidence, not a protocol audit or a production readiness claim.

## Hackathon update: passkey-only backup

Password-based recovery has been removed. The downloaded file is now the encrypted private vault, including its passkey credential metadata. Export verifies it with the original passkey; import authenticates that same credential and never creates a replacement passkey. Restoring requires the original PRF-capable passkey on the same QRAFT domain. There is no independent recovery if that credential is lost. The five-minute spending quarantine and pending-journal reset remain. Earlier password/new-passkey recovery descriptions and recorded E2E results describe the previous implementation and are superseded by this update.
