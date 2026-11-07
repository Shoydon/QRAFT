# QRAFT: three-minute presentation and demo

Seven slides. Aditya records the voiceover. Slide 4 is a handoff to the actual application; the four demo steps are not four extra slides. Confirmation waits must be visibly marked when shortened.

| Time | Slide | Voiceover | Visual cue |
|---|---|---|---|
| 0:00–0:10 | 1 · QRAFT | QRAFT stands for Quantum-Resistant Anonymous Frame Transactions. It combines a unified private ETH balance with ERC-8286 PQ wallets and EIP-8141 transactions. | Title and full form. |
| 0:10–0:25 | 2 · Classic limitations | In Tornado Cash Classic, relayed withdrawals depend on a centralised relayer. Paying another wallet requires withdrawing from the pool. Direct RPC exposes your IP. Funds sit in separate fixed-value notes, and there is no built-in post-quantum wallet. Classic also permits self-submission. | Five limitations; comparison is explicitly Classic only. |
| 0:25–0:40 | 3 · QRAFT solution | QRAFT adds one private balance, exact payments and encrypted receiving. ERC-8286 PQ wallets provide account security. Nym carries requests, and sponsored EIP-8141 transactions reach the alternative mempool directly, without an application relayer. | Five matching solutions, including paymaster-funded setup and gas. |
| 0:40–1:00 | 4 · Demo: deposit | Here is Alice’s public ERC-8286 PQ account. Funding this address is separate from depositing into the private pool. We deposit 0.00002 ETH twice. After confirmation, Alice sees a single private balance of 0.00004 ETH. | Switch to app: public address and balance → two deposits → confirmed private balance. |
| 1:00–1:25 | 4 · Demo: send | Bob shares his receiving address. Alice sends 0.00003 ETH. QRAFT selects both deposit notes and creates a private payment for Bob plus a change note for Alice. Alice retains 0.00001 ETH. Bob opens his ERC-8286 PQ wallet and sees 0.00003 ETH. | Bob Receive → Alice Send → actual confirmations and both balances. |
| 1:25–1:40 | 4 · Demo: withdraw | Bob can continue paying privately or withdraw to a public address. He withdraws 0.00001 ETH. Once confirmed, the public recipient receives the funds and Bob retains 0.00002 ETH privately. The withdrawal amount and destination are public. | Bob Withdraw → receipt → private remainder. |
| 1:40–2:00 | 5 · Keys | Two PQ keypairs derive from one master secret. ML-DSA authorizes account setup and deposits. ML-KEM enables note encryption and decryption. A separate spending secret proves ownership and derives nullifiers. Your passkey protects the master secret locally; it is not your blockchain signing key. | Point to the four key roles and receiving-address contents. |
| 2:00–2:30 | 6 · Private payment flow | Depositing ETH creates an encrypted note, which your wallet adds to one private balance. To pay someone, enter their receiving address and an amount. Your wallet selects enough notes and proves ownership. The pool marks the old notes spent and records a new payment note for the receiver. Their wallet decrypts it and updates their balance. Any leftover value becomes a private change note for you. ETH stays in the pool throughout. | Follow add → send → receive → change; show the 0.05 minus 0.03 example. |
| 2:30–3:00 | 7 · Protocol flow | The factory deploys the public account; the paymaster funds setup and gas. Deposits move ETH into the pool. To send privately, the device selects notes, encrypts payment and change, and generates a proof. Nym carries the frame transaction to the alternative mempool. The shared account validates the proof, the paymaster sponsors gas, and the pool records the new notes. ETH stays pooled until withdrawal. | Follow public deposit and private-send lanes; end on recipient discovery. |

## Recording preparation

1. Use two disposable demo identities with encrypted backups and their original passkeys. Never record backup contents, master secrets, passkey management screens, operator files or developer storage views.
2. Use the current root `/` app. `/app` redirects to it; `/about` contains the product explanation.
3. Prepare the account and faucet balance before the timed take. The external faucet uses a type-2 transfer; do not present it as an EIP-8141 transaction. Funding and depositing are separate actions.
4. Record each transaction through confirmation. Edit waiting periods only with an explicit time-compression caption. Do not splice an unrelated successful receipt into a failed operation.
5. For the shown numbers, begin Alice at zero private balance, deposit 0.00002 ETH twice, send Bob 0.00003 ETH, and withdraw 0.00001 ETH from Bob. The verified E2E uses these amounts; the Demo slide is a handoff, not recorded application footage.
6. If adding recovery footage, record it separately. The real recovery quarantine lasts five minutes of chain time and cannot fit into this three-minute cut unedited.
7. Test the actual Nym connection before recording. The current `private-wallet-e2e-nym.json` records real Nym browser reads and submissions; external payout verification uses an independent direct RPC read. If network conditions prevent a fresh take, label prior recorded footage accurately.


## Delivery status

Deck and narration are ready. Actual application footage and Aditya’s voiceover still need recording and editing. This PDF is a presentation, not a completed video.
