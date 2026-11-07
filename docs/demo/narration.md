# QRAFT: three-minute presentation and demo

Seven slides. Aditya records the voiceover. Slide 5 is a handoff to the actual application; the four demo steps are not four extra slides. Confirmation waits must be visibly marked when shortened.

| Time | Slide | Voiceover | Visual cue |
|---|---|---|---|
| 0:00–0:10 | 1 · QRAFT | QRAFT stands for Quantum-Resistant Anonymous Frame Transactions. It combines a unified private ETH balance with ERC-8286 PQ wallets and EIP-8141 transactions. | Title and full form. |
| 0:10–0:25 | 2 · Classic limitations | In Tornado Cash Classic, relayed withdrawals depend on a centralised relayer. Paying another wallet requires withdrawing from the pool. Direct RPC exposes your IP. Funds sit in separate fixed-value notes, and there is no built-in post-quantum wallet. Classic also permits self-submission. | Five limitations; comparison is explicitly Classic only. |
| 0:25–0:40 | 3 · QRAFT solution | QRAFT adds one private balance, exact payments and encrypted receiving. ERC-8286 PQ wallets provide account security. Nym carries requests, and sponsored EIP-8141 transactions reach the alternative mempool directly, without an application relayer. | Five matching solutions, including paymaster-funded setup and gas. |
| 0:40–0:55 | 4 · Comparison | Compared with Tornado Cash Classic’s fixed-denomination deposit and withdrawal flow, QRAFT supports exact private payments and automatic input selection. Nova also supports shielded transfers. QRAFT combines this payment experience with PQ account authorization and native frame transactions. | Comparison table; retain the Classic/Nova qualification. |
| 0:55–1:20 | 5 · Demo: deposit | Here is Alice’s public ERC-8286 PQ account. Funding this address is separate from depositing into the private pool. We deposit 0.00002 ETH twice. After confirmation, Alice sees a single private balance of 0.00004 ETH. | Switch to app: public address and balance → two deposits → confirmed private balance. |
| 1:20–1:50 | 5 · Demo: send | Bob shares his receiving address. Alice sends 0.00003 ETH. QRAFT selects both deposit notes and creates a private payment for Bob plus a change note for Alice. Alice retains 0.00001 ETH. Bob opens his ERC-8286 PQ wallet and sees 0.00003 ETH. | Bob Receive → Alice Send → actual confirmations and both balances. |
| 1:50–2:15 | 5 · Demo: withdraw | Bob can continue paying privately or withdraw to a public address. He withdraws 0.00001 ETH. Once confirmed, the public recipient receives the funds and Bob retains 0.00002 ETH privately. The withdrawal amount and destination are public. | Bob Withdraw → receipt → private remainder. |
| 2:15–2:40 | 6 · Architecture | That payment starts on the sender’s device: select notes, encrypt outputs and generate a proof. The browser submits the EIP-8141 transaction through Nym Anon RPC with account authorization, sponsorship and pool execution. The pool checks the proof and prevents double spending. The recipient decrypts the incoming note and updates their balance. | Follow the diagram. Explain public deposit and withdrawal branches briefly. |
| 2:40–3:00 | 7 · Results and limits | Ninety-three tests passed, alongside the full browser flow through Nym: deposit, send, recovery and withdrawal. Setup and gas are sponsored, with no application relayer. Wallet signatures and receiving encryption use PQ algorithms; Groth16 does not. Network correlation remains possible. This prototype has not been independently audited. | Results, limitations and repository URL. |

## Recording preparation

1. Use two disposable demo identities with encrypted backups and their original passkeys. Never record backup contents, master secrets, passkey management screens, operator files or developer storage views.
2. Use the current root `/` app. `/app` redirects to it; `/about` contains the product explanation.
3. Prepare the account and faucet balance before the timed take. The external faucet uses a type-2 transfer; do not present it as an EIP-8141 transaction. Funding and depositing are separate actions.
4. Record each transaction through confirmation. Edit waiting periods only with an explicit time-compression caption. Do not splice an unrelated successful receipt into a failed operation.
5. For the shown numbers, begin Alice at zero private balance, deposit 0.00002 ETH twice, send Bob 0.00003 ETH, and withdraw 0.00001 ETH from Bob. The verified E2E uses these amounts; deck cards are explanatory illustrations, not screenshots of a recording.
6. If adding recovery footage, record it separately. The real recovery quarantine lasts five minutes of chain time and cannot fit into this three-minute cut unedited.
7. Test the actual Nym connection before recording. The current `private-wallet-e2e-nym.json` records real Nym browser reads and submissions; external payout verification uses an independent direct RPC read. If network conditions prevent a fresh take, label prior recorded footage accurately.


## Delivery status

Deck and narration are ready. Actual application footage and Aditya’s voiceover still need recording and editing. This PDF is a presentation, not a completed video.
