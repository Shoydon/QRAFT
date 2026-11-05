# PRODUCT.md

Durable product context. Visual decisions live in DESIGN.md.

## What this is

A fixed-denomination privacy pool on Ethereum, with one web surface.
A user deposits a fixed amount of native ETH against a commitment, keeps a
private note file, and later withdraws to any recipient address by proving
locally that they own an unspent note.

Wordmark: **QRAFT** — Quantum-Resistant Anonymous Frame Transactions. It is a
single token in `src/config/brand.ts`, so the interface, page title and footer
all follow from one edit.

The name describes the destination, not the current build. Only the A is
implemented. `SHIPPED_DESCRIPTION` in the same module is what the app is
allowed to say about itself, and it stays accurate as the other two letters
arrive.

## Who it is for

Two audiences, in this order:

1. **ETHGlobal judges on demo day.** They need to see the whole journey work
   end to end in three minutes, understand the privacy claim precisely, and
   see where the real integration boundary sits.
2. **A person moving ETH who does not want their withdrawal address linked to
   their deposit address.** Technically literate, not a cryptographer.

## The job

Deposit → save note → (time passes) → import note → withdraw to a fresh
address. Nothing else. No swaps, exchanges, token approvals, charts, bridges,
or yield.

## The privacy claim, stated exactly

Deposits and withdrawals are both public onchain. The intended property is
that an observer cannot link a particular deposit to a particular withdrawal.
That is an anonymity-set property: it is only as strong as the number of
other unspent notes of the same denomination, and it is weakened by timing,
amounts, gas payment, and the IP address that submitted each transaction.

We do not claim guaranteed anonymity. We do not claim the application is
quantum-proof.

## The note

The note file is the only thing that controls the deposit. It is a bearer
secret: unencrypted, and whoever holds it can spend it. Losing it means
losing access to the deposited ETH. It is not a receipt that is safe to share.

Non-negotiable: note material (nullifier, secret, witness, proof inputs)
never reaches a server, analytics, a log, a URL, or an error report. Notes
stay in memory unless the user makes an explicit, named choice otherwise.

## Lead property: private reads

Every chain read the app makes is routed through Anon-RPC by default, so the
RPC provider learns what was asked but not which browser asked it. This is on
by default and structural, not a settings toggle. If the anonymous transport
cannot start, the app says so and stops reading — it never silently falls back
to a direct RPC connection, because a silent fallback would leak exactly the
link the pool exists to hide.

## Integration status (current)

- **Real:** note generation, encoding, checksum, commitment and nullifier
  hashing (Poseidon), file export/import, format and deployment-identity
  validation. Anon-RPC transport and live chain reads.
- **Simulated behind an adapter:** deposit submission, note inclusion and
  spent-status lookups, proof generation, withdrawal submission, and
  transaction reconciliation. No pool contract is deployed and no proving
  artifacts (wasm/zkey) exist in this repo yet.

Simulated results are labelled in the interface and in every receipt. A
simulated receipt must never be mistakable for a real transaction.

## Assumptions made without a human answer

Recorded because the structured probe returned a track brief rather than
answers to these specific points:

- Preview mode is presented as a persistent header bar plus a `SIMULATED` stamp
  on every receipt and hash, rather than a quiet chip.
- Anon-RPC defaults **on**, which is stronger than the shipped adopters that
  default it off. Chosen because the track rewards traffic actually routed
  through it, and because the brief forbids silent fallback.
- Denominations are 0.01 / 0.1 / 1 / 10 ETH, taken from the protocol's own
  fixed set rather than invented.
