# QRAFT demo deck

A 7-slide, 16:9 product-demo draft for a three-minute technical hackathon video.

- `qraft-demo.pdf`: presentation PDF.
- `qraft-demo.html`: editable source, based on the pitch-deck-builder template.
- `narration.md`: 180-second narration, shot list and recording preparation.

The demo slide gives a four-step recording guide. No investor ask or commercial pricing is implied.

## Protocol description

QRAFT is a private ETH payment protocol using ERC-8286 PQ wallets and EIP-8141 transactions. ETH is held in a shared pool; encrypted notes represent private funds. Devices create spending proofs locally and decrypt incoming notes. The pool checks proofs and nullifiers before recording payment and change outputs or releasing a public withdrawal.

Slide 6 diagrams these paths. Wallet signing and receiving encryption use PQ algorithms; Groth16 proofs do not. The three-minute edit is intended for Aditya’s own voiceover.

## Slide order and claim sources

1. QRAFT: identity and unified private balance.
2. Problems: sender identity, quantum-vulnerable signatures, RPC metadata, execution and gas complexity, and fragmented private funds.
3. Solution: private payments, automatic balance, exact amounts and passkey control.
4. Comparison: Tornado Cash Classic only, with Nova’s overlapping capabilities disclosed.
5. Demo: app handoff for deposit, transfer, receipt and withdrawal.
6. Architecture: local proof, direct Anon RPC submission, pool verification and recipient discovery.
7. Results and limits: test evidence, cryptographic and network boundaries.

QRAFT claims are grounded in `src/lib/private-wallet/`, `src/config/brand.ts`, `docs/pq/private-wallet-e2e-nym.json`, `docs/pq/private-pool-direct-live.json` and `docs/pq/private-wallet-review.md`.

Comparison sources:
- [Classic deposit, withdrawal and optional encrypted Note Account](https://github.com/tornadocash-community/docs/blob/en/tornado-cash-classic/deposit-withdraw.md)
- [Classic fixed-denomination design](https://tornado.cash/audits/TornadoCash_whitepaper_v1.4.pdf)
- [Nova arbitrary amounts, shielded transfers and balance](https://docs.tornado.cash/tornado-cash-nova/logging-in-tornado-cash-nova)

This is a feature comparison, not a security ranking. The title’s anonymity language does not imply protection against every observer: public entry/exit amounts and addresses remain visible, and network activity can still permit correlation. Groth16 proofs are not post-quantum. The demo uses illustrative amounts from verified E2E evidence; no recorded footage is embedded in this PDF.

## Render

The HTML declares 1920 × 1080 pages and loads Inter from Google Fonts with local system fallbacks. Open it in Chromium and print with CSS page size and no headers, or run the pitch-deck-builder skill's `assets/build.sh` against it. Timing and slide count should be rechecked after edits.
