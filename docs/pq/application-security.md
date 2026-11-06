# Application security and external limits

The supported scope is post-quantum **application** security with explicit external limits. It is not a claim that the complete internet, Ethereum or Nym is post-quantum.

## Application boundary

- ML-DSA-44 signatures authorize exact native frame transactions. The browser independently derives and verifies the prepared public key, descriptor, immutable account configuration, CREATE2 address and deployed runtime. No ordinary Ethereum signature can substitute for the user's ML-DSA signature.
- Notes use 64 random secret bytes, SHA3-512 commitments and nullifiers, and a depth-32 SHA3-512 Merkle tree. Checksums detect accidental backup corruption, not malicious replacement.
- Transparent V5 proofs use the pinned SPBCS/stream/writeback Goldilocks5 profile. The browser verifies the proof before exporting its public envelope. The public-only encoder independently binds the statement and verifies the native proof; it rejects private witness fields. Read the [V5 security argument](pq-v5-security-argument.md) and [salt lemma](pq-finite-field-salt-lemma.md) for assumptions and research limitations. Do not infer a certified 128-bit quantum-security guarantee from use of these primitives.
- The application pins chain genesis/anchor and contract runtimes. It checks exact canonical receipts, native frames and withdrawal events. Secrets remain in memory or user-downloaded files. Public signed-intent journals can still reveal transaction relationships.

## External trust and privacy

The devnet's consensus, historical deployments, RPC infrastructure, TLS certificates, browser/OS and software distribution are outside this PQ boundary. Runtime and file hashes provide consistency checks; they do not make a compromised distribution channel safe.

The local helper holds an ordinary ECDSA **test gas-carrier** key. It funds new accounts, deploys public key data, caches signatures that it verifies against the public ML-DSA key, uploads public proof bytes and advances permissionless verification. This key is not the custody authority for the user's account or pool notes. Its compromise can spend carrier funds, disrupt availability and expose public transaction relationships. It cannot fabricate an ML-DSA signature or a valid private-note proof.

Nym browser reads and submissions use Anon-RPC by default. Worker discovery/bootstrap is direct. The local helper uses direct RPC for public provisioning, signature caching and proof computation, linking those requests to the local machine. An untrusted RPC can delay or withhold data; anonymous transport does not make responses trustworthy. Explicit passthrough is not anonymous. Nym has its own [post-quantum roadmap](https://nym.com/blog/nym-post-quantum-roadmap); Ethereum describes its own [quantum-resistance work](https://ethereum.org/roadmap/security/quantum-resistance/). Neither is covered by QRAFT's application claim.

The helper is an opt-in, loopback-bound development service with same-origin guards, bounded inputs and a protected local key. It has no public authentication or quota system. Do not expose the listener through a tunnel, reverse proxy or external interface. Hosted deployment requires a separate service design, persistent execution and upload handling; this version is intended to run locally.

A withdrawal recipient may be any valid address. Funds paid to an ordinary EOA are subsequently protected by that recipient's classical key; use a PQ account recipient when post-quantum custody after payout is required. QRAFT cannot upgrade a recipient's authorization scheme.

## Recovery and availability

Native signed intents are journaled before disclosure. An uncertain receipt freezes that intent until reconciliation; it is not permission to replace it with a new nonce. Keep wallet and note backups. Public proof/session progress can be resumed where the journal and canonical chain evidence agree.

The gas carrier also journals exact signed transactions and permits one writer. A process crash can leave its lock or a pending transaction. Inspect the public journal and chain receipt before manual reconciliation; automatically deleting a lock can permit nonce races. Public encoder jobs detect a stopped process, but PID reuse and a stopped carrier can still require operator intervention.

Proof verification uses a fixed public call sequence. Another party advancing the same permissionless session can make a scheduled call revert; the helper stops instead of guessing a replacement sequence. This is an availability limitation, not a claim of adversarially resilient concurrent execution. Devnet resets, gas exhaustion, timeouts and expiry may interrupt a withdrawal. Keep the note and reconcile confirmed session/transaction state before trying again.

Small anonymity sets, reused recipients/accounts, timing and the shared public gas carrier can link deposits and withdrawals. Successful proof verification does not establish practical anonymity. Never use real funds in this experimental deployment.
