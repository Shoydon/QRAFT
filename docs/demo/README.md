# QRAFT demo deck

A 10-slide, 16:9 product-demo draft for a three-minute technical hackathon video.

- `qraft-demo.pdf`: presentation PDF.
- `qraft-demo.html`: editable source, based on the pitch-deck-builder template.
- `narration.md`: 180-second narration, shot list and recording preparation.

The three inline product views are illustrative deposit, private-send and withdrawal states. They replace the generic invoice/email/agent views because those features do not exist in QRAFT. No investor ask or commercial pricing is implied. Application gas is currently sponsored; that is not a permanent pricing commitment.

## Claim sources

| Slides | Claim | Source |
|---|---|---|
| 1, 4, 8 | Product name, PQ keys, ERC-8286, EIP-8141 | `src/config/brand.ts`, `src/lib/private-wallet/crypto.ts`, `src/lib/private-wallet/frames.ts` |
| 2, 3, 6 | Separate public/private balance, note selection, change | `src/lib/private-wallet/engine.ts`, `planner.ts`, `discovery.ts` |
| 4 | Same-passkey encrypted backup | `src/lib/private-wallet/vault.ts`, `docs/pq/private-wallet-browser.json` |
| 5–7 | Exact illustrated deposit/send/withdraw amounts | `docs/pq/private-wallet-e2e.json` |
| 8 | Three-frame successful transactions | `docs/pq/private-pool-live.json`, `src/lib/private-wallet/receipt.ts` |
| 9 | 90 tests; review and test scope | `docs/pq/private-wallet-review.md` |
| 9, 10 | Current limits and proposed follow-up | `docs/pq/private-wallet-review.md` |

The deck is grounded in the current implementation. Cryptographic keys use PQ algorithms, while the Groth16 proof system does not. E2E payment evidence uses injected direct reads and actual native sidecar transactions. The provided faucet is external and uses transaction type 2. Further anonymity work and independent review are proposed next steps, not completed features.

## Render

The HTML declares 1920 × 1080 pages and loads Inter from Google Fonts with local system fallbacks. Open it in Chromium and print with CSS page size and no headers, or run the pitch-deck-builder skill's `assets/build.sh` against it. Timing and slide count should be rechecked after edits.
