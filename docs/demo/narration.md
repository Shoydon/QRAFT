# QRAFT: three-minute demo script

First draft. Product-launch deck adapted for a technical hackathon demo. Runtime: 180 seconds. Slides 5–7 are visual anchors for recorded application footage, not a claim that the entire live transaction flow completes in that time.

| Time | Slide | Voiceover | Recording cue |
|---|---|---|---|
| 0:00–0:10 | 1 · QRAFT | “QRAFT stands for Quantum-Resistant Anonymous Frame Transactions. It combines an ERC-8286 PQ wallet with private ETH payments and native EIP-8141 execution.” | Centered title and full form. |
| 0:10–0:22 | 2 · Two balances | “Your public smart account and your private balance are different. Public ETH sits at your account address. Depositing creates encrypted notes in a pool, which your device discovers and adds together.” | Briefly show the two-balance diagram. |
| 0:22–0:37 | 3 · One balance | “Users see one available balance. Underneath, QRAFT selects unspent notes, proves ownership, and returns change automatically. Here, two separate deposits appear as one balance of 0.00004 ETH.” | Show note diagram, then the actual confirmed balance. |
| 0:37–0:55 | 4 · Keys | “One passkey unlocks the ERC-8286 PQ wallet. ML-DSA signs account transactions, ML-KEM protects incoming notes, and a separate spending secret proves ownership. These derive from one master secret. The encrypted backup needs the original passkey.” | Show the three key purposes. Keep passkey prompt and backup file contents out of the recording. |
| 0:55–1:20 | 5 · Deposit | “In the top-right dialog, I can see my public address and fund the account. I then deposit 0.00002 ETH twice. QRAFT prepares the account, generates the proof locally, and submits the deposit. Once confirmed, both notes contribute to my private balance.” | Actual app: public address/balance → Add ETH → amount → review → progress → confirmed total. Compress confirmation waits with a visible ‘Time compressed’ caption. |
| 1:20–1:50 | 6 · Send | “Bob shares his QRAFT receiving address. It contains public receiving information, not his secrets. I send 0.00003 ETH. The wallet combines my two inputs, creates Bob’s encrypted payment, and returns 0.00001 ETH to me as private change. I never select or export individual notes.” | Actual app: Bob Receive → copy full address → Alice Send → review 0.00003 → progress → Alice 0.00001. Show real confirmation. |
| 1:50–2:20 | 7 · Receive and withdraw | “Bob’s device decrypts the incoming note and shows 0.00003 ETH. He can keep paying privately or withdraw to a normal Ethereum address. Withdrawing 0.00001 leaves 0.00002 in the private balance. The withdrawal address and amount are public.” | Actual Bob session: receiving balance → Withdraw → public address → confirmation → 0.00002 remaining. Show a verified explorer receipt briefly. |
| 2:20–2:35 | 8 · Native frames | “Each application payment uses an EIP-8141 transaction: authorization, gas sponsorship, then pool settlement. The pool checks the proof and rejects reused nullifiers. Private sends use a shared carrier account.” | Three-frame diagram; optionally replace its final seconds with a successful type-6 receipt. |
| 2:35–2:50 | 9 · Evidence and limits | “Ninety tests and a live end-to-end flow passed. The current Groth16 proof is conventional cryptography. Nym protects reads and deposits, while the HTTPS relay still sees network metadata. This is a prototype, not an audited production system.” | Evidence and boundaries slide. Do not crop away qualifications. |
| 2:50–3:00 | 10 · Close | “QRAFT brings a unified private balance, encrypted receiving, and local proofs to ERC-8286 PQ accounts. The implementation and test evidence are available in the repository.” | Repository URL and product identity. |

## Recording preparation

1. Use two disposable demo identities with encrypted backups and their original passkeys. Never record backup contents, master secrets, passkey management screens, operator files or developer storage views.
2. Use the current root `/` app. `/app` redirects to it; `/about` contains the product explanation.
3. Prepare the account and faucet balance before the timed take. The external faucet uses a type-2 transfer; do not present it as an EIP-8141 transaction. Funding and depositing are separate actions.
4. Record each transaction through confirmation. Edit waiting periods only with an explicit time-compression caption. Do not splice an unrelated successful receipt into a failed operation.
5. For the shown numbers, begin Alice at zero private balance, deposit 0.00002 ETH twice, send Bob 0.00003 ETH, and withdraw 0.00001 ETH from Bob. The verified E2E uses these amounts; deck cards are explanatory illustrations, not screenshots of a recording.
6. If adding recovery footage, record it separately. The real recovery quarantine lasts five minutes of chain time and cannot fit into this three-minute cut unedited.
7. Test the actual Nym connection before recording. Existing E2E evidence uses direct test reads; never describe that test as full-Nym validation. If network conditions prevent a fresh take, label prior recorded footage accurately.

## What remains before the video

The deck and voiceover draft are ready for review. Actual demo footage, voice recording and video editing are not included. The narration is written for a three-minute cut; rehearse once and trim pauses to match the timecodes. No founder, traction, launch-date, pricing or security-audit claims have been invented.
