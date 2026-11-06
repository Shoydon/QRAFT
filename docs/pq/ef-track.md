# EF track evidence

## Frame Transaction Alternative Mempool

Active chain: 1337. The native ML-DSA verification frame consumes approximately 2.39 million execution gas, well above the simple public-mempool validation budget. Both the sponsored deposit and atomic withdrawal were admitted and included through the alternative mempool.

- [Deposit](https://explorer.altmempool.wtf/tx/0x38ff98c1a2bbc903f157ab9d083a47a8cb50b9bc7adb323d191939b948c07316)
- [Withdrawal](https://explorer.altmempool.wtf/tx/0x19f9ef5d4ffcb2342ca4828becb3ec8c9c631575e85541f122c9ba4424e791d7)
- Code: `src/lib/atomic/account.ts`, `packages/frame-account/src/alt-mempool.ts`
- [Receipts and active addresses](atomic-live.json)

EIP-8141 describes the transaction format. 1337 is the devnet chain ID; it is not a replacement EIP.

## Anon-RPC

The browser uses the actual hash-pinned Nym worker for reads and submission. The host header-serialization compatibility patch preserves the pinned worker bytes. No silent direct-RPC fallback is provided. Nym hides the browser's IP from the RPC provider, not public transaction contents. Bootstrap discovery and the server's public provisioning have distinct privacy boundaries.

## CROPS

The application is open source, keeps private note witnesses and signing seeds local, uses a directly verifiable onchain proof and accepts an arbitrary recipient. The new architecture removes 663-step verifier orchestration and per-proof deployments. The initial deployment and public account-provisioning operator remain centralization limitations; devnet availability and sponsorship are not guaranteed.

Security scope is explicit: ML-DSA wallet authorization, conventional Groth16 withdrawal proof, development trusted setup, no independent audit. These are implementation and evidence claims, not a guarantee of prize eligibility or an award.
