# QRAFT product context

QRAFT moves native ETH into and out of a fixed-denomination privacy pool. The active deployment supports **0.0001 ETH** on Ethrex devnet 8141. Keep the paper/spectral visual language in DESIGN.md and the QRAFT branding.

The deposit journey creates a browser ML-DSA wallet, requires an explicit wallet backup, creates a private SHA3-512 note, requires a separate note backup, then submits a native frame transaction. Wallet seeds and note witnesses never go to the helper or browser storage.

Withdrawal imports the note, reconstructs and checks the Merkle witness using anonymous chain reads, binds the proof to the deployment, recipient and expiry, and generates/verifies V5 locally. Only public proof material is exported. ML-DSA account transactions authorize session creation, attachment and the final withdrawal. A local helper pays for public computation; the recipient receives the entire denomination in native ETH.

A confirmed receipt must contain the exact expected native frames and pool event. Unknown results preserve the signed intent and stop conflicting actions. Reload recovery uses public journals plus explicitly imported backups. Keep secrets until final settlement; devnet inclusion is not finality.

Do not describe the entire environment as post-quantum or all traffic as anonymous. Application authorization and note/proof design target post-quantum security; Ethereum/devnet consensus, deployment history, gas infrastructure, TLS, browser/OS and Nym remain external limits. The experimental proof has no independent production audit. The local helper uses direct RPC. Explain these boundaries in the read-path/security details and [application-security.md](docs/pq/application-security.md).

The active interface has no ordinary-wallet, Groth16 or wrapped-token fallback. Historical implementation files are reference only. The local helper must remain loopback-only and requires a protected disposable gas key. It is not a publicly deployable authenticated service.

The landing page at `/` centers the full QRAFT name and presents EIP-8141, Anon-RPC and the post-quantum wallet stack; `/app` hosts the PQ deposit and withdrawal interface and links back home. Preserve the updated landing-page design and shared visual system. Support both cold evaluators and people following the native ETH journey.
