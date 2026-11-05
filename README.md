# QRAFT

**Q**uantum-**R**esistant **A**nonymous **F**rame **T**ransactions.

What ships today is the middle letter: a fixed-denomination privacy pool on
Ethereum, with every chain read routed through anon-rpc. Deposit a fixed
amount of native ETH against a commitment, keep the private note, and later
withdraw to any address using a proof generated in your browser.

Quantum-resistant account access and EIP-8141 frame transactions are the
direction, not the current state — see **Not done yet**. No surface in the
app claims either.

The wordmark lives in [`src/config/brand.ts`](src/config/brand.ts) — the
header, page title and footer all read from it.

---

## Run it

```sh
npm install
npm run dev          # http://localhost:3000
```

```sh
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # next build
npm run check        # all three
```

Node 20+ and npm 10+. No wallet, RPC key, or deployed contract is needed to
run it; see **What is real, what is simulated** below.

### Optional configuration

Copy [`.env.example`](.env.example) to `.env.local`. Every variable has a
working default except the KPS gateway list, which is empty because no
long-lived public gateway exists to point at. See **Read path** below.

---

## What the product does

One screen, two tabs.

**Deposit** — choose a denomination (0.01 / 0.1 / 1 / 10 ETH) → see amount,
fee and pool → generate a note locally → download it and explicitly
acknowledge that losing it loses the deposit → connect a funding wallet →
submit → watch it confirm → receipt. A deposit is never shown as successful
before its transaction is confirmed. If submission or confirmation fails, the
note is preserved and the screen says exactly what is and is not known.

**Withdraw** — import a note from a file or paste field → the app validates
its format and deployment identity → shows the denomination and whether the
note is ready, pending, spent, or currently uncheckable → enter a recipient →
review recipient, amount and who pays gas → generate the proof locally with
staged progress → submit → confirm → receipt. The note is marked spent only
after a confirmed transaction.

No wallet connection is required to import a note or generate a proof. A
wallet is requested only when a transaction actually needs funding, and never
automatically on page load.

### The privacy claim, stated precisely

Deposits and withdrawals are both public onchain. The intended property is
that an observer cannot link a particular deposit to a particular withdrawal.
That hiding is only as strong as the number of other unspent notes of the same
denomination, and it is weakened by timing, by gas payment, and by reusing an
address. The interface says this and does not promise guaranteed anonymity,
and nothing in it is described as quantum-proof.

---

## What is real, what is simulated

No pool contract is deployed and no proving artifacts (wasm/zkey) ship with
this repo, so the app runs in **Demo mode**, announced in a persistent banner.

**Real:**

- Note generation — rejection-sampled BN254 field elements from
  `crypto.getRandomValues`, Poseidon commitment and nullifier hash
  (`poseidon-lite`), keccak checksum, file export and import, format and
  deployment-identity validation. See [`src/lib/note.ts`](src/lib/note.ts).
- Wallet connection, account, chain and balance, when the browser has an
  EIP-1193 wallet. Only the submission is simulated.
- The Anon-RPC read transport and the live gas-price read it performs.

**Simulated, behind adapters:** deposit submission, note inclusion and
spent-status lookups, proof generation, withdrawal submission, and transaction
reconciliation.

Every simulated value carries `simulated: true` through the adapter layer.
Simulated transaction references begin with four zero bytes — which a real
hash essentially never does — are stamped `SIMULATED` wherever they appear,
and are never linked to a block explorer. A simulated receipt cannot be
mistaken for chain activity.

### The adapter boundary

[`src/lib/adapters/types.ts`](src/lib/adapters/types.ts) defines six small,
typed adapters: account access, deposit submission, note validation, proof
generation, withdrawal submission, and transaction reconciliation. The
simulated implementations live in
[`src/lib/adapters/demo.ts`](src/lib/adapters/demo.ts) and nothing in the
interface imports them directly — resolution happens in
[`src/lib/adapters/index.ts`](src/lib/adapters/index.ts).

**To wire a real backend:** implement `Backend` against a deployed pool, add
it beside `demoBackend`, and set `DEPLOYMENT.backend` to `'chain'` in
[`src/config/pool.ts`](src/config/pool.ts). `getBackend()` throws rather than
serving simulated data under a real label if that flag is set with no chain
backend present.

### Demo scenarios

The Demo mode banner has a scenario picker. It forces any designed state —
insufficient balance, rejected deposit, unknown outcome, reverted transaction,
pending note, spent note, uncheckable note, proof failure, depleted sponsor,
unreachable sponsor — so the whole state space is reachable in a demo without
a chain. It is a diagnostic and deliberately lives outside the deposit and
withdraw journeys. A real backend ignores it entirely.

---

## The chain

The [EIP-8141 alternative-mempool devnet](https://docs.altmempool.wtf/guides/devnet/),
chain id **1337**. Frame transactions run on no public testnet, so this is the
only chain the project's direction can target.

| | |
|---|---|
| Execution RPC | `https://altmempool.forshtat.com` |
| Sidecar RPC (frame transactions) | `https://altmempool.forshtat.com/rpc` |
| Explorer | `explorer.altmempool.wtf` |
| Block time | 6 seconds |

Know what you are pointing at: it is a demonstration network with no security
model and no persistence guarantee, and it may reset at any time. Measured
over 24 hours it produced roughly 2,000 blocks against the ~14,400 a
continuous 6-second cadence implies, so it is not reliably up. Do not plan a
demo around it being live without checking first.

Because the chain id is written into every note, a reset leaves old notes
validating against deposits that no longer exist — they read as permanently
pending. After any reset, bump `DEPLOYMENT.id` in `src/config/pool.ts` so
stale notes are refused outright instead.

## Read path

Every chain read goes through [anon-rpc](https://github.com/ethereum/anon-rpc)
by default. The harness resolves a hash-pinned anon-client bundle from an
on-chain specifier contract, refuses to execute bytes whose `keccak256` does
not match, runs it in a Web Worker inside a null-origin sandboxed iframe, and
hands back an anonymized `fetch`. The RPC provider then sees the request but
not the browser it came from.

There is **no direct-RPC fallback**, by design. A silent fall back to a direct
connection would leak the link between a browser and the notes it is reading
about — the exact link the pool exists to hide. If the transport cannot start,
reads stop and the Read path panel says why.

One read is not anonymized: the bootstrap read of the specifier contract that
learns the pinned worker hash. It reveals that a specifier contract was read,
not any address. The interface states this rather than hiding it.

**Default worker: `tor-js`.** Browsers cannot open the raw TCP that Tor needs,
so it reaches the network through KPS relays, and it needs at least one
gateway in `NEXT_PUBLIC_ANON_RPC_GATEWAYS`. With none set, the Read path panel
reports "Not configured" and names the variable — it does not spend a minute
on a boot that cannot succeed. Run your own gateway for anything real; the
anon-rpc project's
[`adopters.json5`](https://github.com/ethereum/anon-rpc/blob/main/adopters.json5)
lists a demonstration gateway and documents its limits.

Setting `NEXT_PUBLIC_ANON_RPC_WORKER=passthrough` selects the reference worker,
which fulfils reads with an ordinary fetch. It anonymizes nothing, and the
Read path panel says so in those words when it is selected.

---

## CROPS

**C — Censorship resistance.** What you depend on from us: the domain serving
this static frontend. There is no backend, API, or relayer of ours in any
path. The app is a static Next.js build; `npm run build` produces something
you can host anywhere, and notes are plain files that are not tied to this
origin. What you depend on from third parties: the RPC provider in
`NEXT_PUBLIC_READ_RPC_URL` and the anonymizing network's gateway operators,
both of which are configuration you control. If the anonymizing network
refuses you, reads stop with a stated reason rather than silently reverting to
a direct connection.

**O — Open source.** MIT, in [`LICENSE`](LICENSE). This README is the complete
build instruction; there is no private step and no bundled binary. The
anon-client bundle is fetched at runtime and verified against a hash published
on-chain, so it is not something we can substitute.

**P — Privacy.** Our server learns nothing, because there isn't one. The RPC
provider learns which calls were made but not which browser made them, since
reads travel through the anonymizing network. The anon-client worker is
untrusted-but-sandboxed: it sees every request routed through it, which is why
it is pinned by hash and auditable. The bootstrap provider learns that a
specifier contract was read, once. There are no analytics, trackers, or error
reporting of any kind. Notes, nullifiers, secrets and witnesses never leave
the browser and are never placed in a URL, a log, or a request body.

**S — Security.** Note secrets are generated with `crypto.getRandomValues`,
rejection-sampled into the BN254 scalar field, and held in memory only —
nothing is persisted to `localStorage`, `IndexedDB`, cookies, or anywhere
else, and a reload discards them. The note file the user downloads is the only
copy, which the interface states plainly and does not claim to have backed up.
The app never asks for a seed phrase or a private key. Trust assumptions: the
pool contract and circuit (unaudited, and not deployed in this build), the
hash-pinned anon-client, and the specifier contract's owner.

**Trade-offs we are stating rather than hiding:** the anonymizing network adds
real latency; chain *writes* go through the user's own wallet and therefore
its RPC, not through anon-rpc; and the frontend is currently served from one
domain, so censorship resistance today rests on the build being reproducible
and self-hostable rather than on content addressing.

---

## Not done yet

- **No pool contract, no circuit, no proving artifacts.** Everything
  chain-facing is simulated. This is the one blocker between Demo mode and a
  working deployment.
- **No gas sponsor.** The gas-policy adapter models sponsored, depleted,
  unreachable and self-funded, but no paymaster is wired. Sponsorship is never
  advertised unless the backend reports a funded one.
- **No KPS gateway shipped**, so the default read path reports "Not
  configured" until one is set.
- **Writes are not anonymized.** Transactions go through the user's wallet,
  which uses its own RPC. Routing writes through the anonymizing network, or
  through an alternative mempool, is future work.
- **No persistent note storage.** Deliberate: any persistence must be an
  explicit, clearly explained choice, and that choice has not been designed
  yet.
- **No automated tests.** Verification so far is `npm run check` plus a
  scripted browser walk of both journeys and the edge states.
- **Not quantum-resistant yet.** The Q in the name is the goal. Note
  commitments use Poseidon over BN254 and the eventual proof system is
  classical; post-quantum account access would be a separate mechanism, kept
  deliberately apart from note ownership so that losing one does not lose the
  other.
- **No frame transactions yet.** The F in the name points at EIP-8141 and the
  alternative mempool. The app reads from the devnet but submits through the
  user's ordinary wallet. Frame transactions, sent to the sidecar at
  `https://altmempool.forshtat.com/rpc`, would be what lets the pool itself pay
  for a withdrawal, removing the need for a funded recipient address.
- **No explorer links.** The devnet explorer's URL scheme is not documented,
  so `explorerBase` is null rather than a guess. Transaction references render
  without a link until someone confirms the real path.

---

## Design

[`DESIGN.md`](DESIGN.md) records the visual system; [`PRODUCT.md`](PRODUCT.md)
records product truth and the assumptions made where a human answer was not
available.

Unaudited software, built for a hackathon demo. Do not put money you care
about through it.
