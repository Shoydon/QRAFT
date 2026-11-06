# EF integration status

The active application targets **chain 1337**, using EIP-8141 frame transactions. The proposal number 8141 is not the network ID. The [official devnet guide](https://docs.altmempool.wtf/guides/devnet/) and [workshop](https://github.com/forshtat/mempool-workshop) specify this network.

## Routes

| Purpose | Endpoint |
| --- | --- |
| Execution and simulation | `https://altmempool.forshtat.com` |
| Alternative-mempool submission | `https://altmempool.forshtat.com/rpc` |
| Explorer | `https://explorer.altmempool.wtf/` |

Browser RPC uses the official Nym worker by default, including sidecar submission. There is no automatic direct fallback. Nym hides the browser IP from the destination RPC; it does not hide public transaction contents, addresses, amounts, or timing correlations. Worker discovery uses a direct Ethereum bootstrap RPC. The local public-data/proof helper and CLI tests use direct RPC; their traffic is not anonymous.

The client encodes the devnet's nine-field type-0x06 envelope and submits JSON using `eth_sendFrameTransaction`. It checks the returned hash against the signed intent. PQ authorization is verified directly in the sender VERIFY frame, with a larger verification budget than the standard public mempool permits. The sender and paymaster stake in the devnet registry. Application and public-helper writes use the sidecar with no canonical fallback.

One-time shared infrastructure deployment uses explicit native execution-RPC transactions where necessary: the cryptographic primitive deployment exceeds the sidecar's 25-million-gas transaction budget. Those bootstrap receipts are not presented as alternative-mempool evidence.

## Evidence and limitations

The following native transaction was submitted through the sidecar and included successfully:

[Chain-1337 sidecar probe](https://explorer.altmempool.wtf/tx/0x878a98ba54c02ccafc67fbd5d6e7c2d028eb05cd87e25911b83d5c9a23290ad8)

The account implementation deployment also passed sidecar admission and inclusion:

[Account implementation deployment](https://explorer.altmempool.wtf/tx/0xc58aa78e4f140df7055d6073d7172ff10c0cc07cb49bb7ca115615b33ed6d747)

These are operator-authorized infrastructure transactions, not proof of a sponsored PQ deposit or full withdrawal. Fresh PQ account creation and staking succeeded through the sidecar. The sponsored PQ deposit passed execution simulation, but sidecar admission rejected it under OP-011: `sender uses banned opcode: GAS`. The manifest disables application transactions until this is resolved. See [the public admission report](alt-mempool-admission.json). No deposit or withdrawal success is claimed on 1337. The devnet has also admitted transactions and subsequently cancelled them after four relays without inclusion; admission alone must not be labelled confirmation. The client preserves pending signed intents for reconciliation.

The historical [complete withdrawal evidence](application-checks.json) belongs to the previous chain-8141 deployment and does not establish chain-1337 withdrawal success. Only the default 0.0001 ETH pool is currently activated on 1337.

## Track scope

The [EF prize page](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation) lists Anon-RPC, alternative mempool, and CROPS tracks, with at most one EF prize per project. Submission code and explorer evidence support alternative-mempool review; final eligibility and awards are determined by judges. A short demonstration video remains a submission deliverable.

README documents CROPS properties and limitations. There are no configured third-party analytics. ML-DSA-44 authorization, SHA3-512 notes, and the transparent proof cover application cryptography; consensus, TLS, Nym, operator keys, and availability have separate assumptions. The proof remains experimental. See [security boundaries](application-security.md) and [licenses](../../NOTICE.md).
