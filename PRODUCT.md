# QRAFT product context

QRAFT is a private ETH wallet on the EF alternative-mempool devnet, chain **1337**. A user unlocks once, sees one private balance, sends exact amounts to other wallets, receives while offline, and withdraws to any public address. Notes, proofs, input selection, merging and change are wallet internals the user never handles. Keep the paper/spectral visual language in DESIGN.md and the QRAFT branding.

The wallet is created in the browser, protected by a WebAuthn passkey, and backed up as **one portable encrypted recovery file** that restores both spending ability and incoming payments. There is no per-note backup and no separate viewing key: signing, spending and receiving keys all derive from one master secret. A cleared browser restores from that file plus the original passkey.

Value moves through a native ETH join/split pool: a four-input, two-output Groth16 circuit over a depth-20 Poseidon tree. Adding ETH is a public deposit. Sending is private, selects inputs automatically and returns private change. Combining is explicit and only consolidates the user's own balance. Withdrawal pays the exact amount in native ETH to any recipient, including an EOA. Every action is one native EIP-8141 transaction whose three frames authorize the ML-DSA-44 wallet signature, approve paymaster gas, and execute the pool call atomically.

**Do not describe this as an end-to-end post-quantum system.** ML-DSA-44 authorizes wallet transactions and ML-KEM-768 encrypts receiving payloads, but private ownership is proved by a conventional Groth16/BN254 circuit, and consensus, transport, browser and OS remain outside any post-quantum claim. The proving parameters are a single-operator development setup, not a ceremony. Say so wherever the proof is described.

Transport has two distinct boundaries and the UI must not blur them. Chain reads and the user's public deposits use Nym Anon-RPC, with no direct fallback on failure. Private sends and withdrawals go through a shared HTTPS relay that **can see the requesting IP and timing**. Deposit and withdrawal amounts and addresses are public on chain either way; ML-KEM confidentiality does not prevent traffic correlation. Devnet inclusion is not finality, and an unknown transaction outcome is reconciled rather than retried with a fresh nonce.

Routes: `/` is the private wallet, `/about` explains the stack for evaluators, and `/pq` runs the earlier V5 hiding-STARK application. V5 notes are a different pool with incompatible notes and are never relabelled or migrated silently. `/app` redirects to the root and is relied on by the browser test scripts.

The interface serves both a cold evaluator and someone moving real devnet ETH. Support both without a demo or simulation vocabulary.
