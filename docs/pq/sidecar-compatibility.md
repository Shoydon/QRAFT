# Alternative-mempool verifier compatibility

Resolved on chain 1337. The earlier `sender uses banned opcode: GAS` rejection came from 40 profiling snapshots inside the ML-DSA number-theoretic transforms, **not** clone or Solidity call forwarding. The execution trace attributed all rejected GAS reads to the verifier. The earlier diagnosis that call forwarding itself was unsupported was incorrect.

The production build adapter removes profiling stores, their unused buffer, and the profiling-only arguments. The pinned upstream sources and NTT arithmetic remain unchanged. Prepared-key row size and code-hash checks, signature checks, and account/paymaster authorization remain enforced.

The corrected verifier accepted valid signatures for five messages and rejected mutated messages/signatures. For the same initial signature, direct-RPC estimation changed from 1,652,759 to 1,652,612 gas: a small 147-gas reduction, not a large cryptographic optimization. See [comparison](verifier-gas-comparison.json).

[The sponsored PQ deposit](https://explorer.altmempool.wtf/tx/0x4894d2fecb0cd81fc9add3f5268e565cc5b672afc51d6f312613713b0fef7c41) passed all sidecar admission checks and was included on chain 1337. All three frames succeeded; the payer was the deployed QRAFT paymaster. [Full public evidence](alt-mempool-deposit.json).

## Independent frame budgets

User transactions retain separate PQ VERIFY, paymaster VERIFY, and SENDER execution frames. PQ verification now requests 2.2 million execution gas, compared with the earlier 3 million; the measured deposit verification frame used about 1.63 million. Simple public setup calls request 500,000 execution plus 1,000,000 state gas rather than 14.5 million plus 10 million. Each transaction is simulated before submission.

These are reductions in declared budgets. Actual gas consumed and charged is reported separately in receipts. The privacy-pool Merkle update remains the largest deposit cost; removing checks or changing the tree/proof parameters merely to lower that number would change the security model.

Public proof verification is already a staged program of bounded calls. Splitting user authorization across independently approved transactions would require a different authorization design; it is not achieved simply by reducing a gas limit.

On chain 1337, a new public proof session groups up to four ordered verifier calls into atomic SENDER frames, each with an independent execution/state limit. Groups are simulated together and reduced before submission if necessary. Three/four-call groups reserve 4 million execution and 2 million state gas per call (under 25 million in total including authorization); two-call groups reserve 8 million execution and 3 million state gas per call. This reflects the first live batch using about 2.5 million execution gas and 783,360 state gas for its largest call. The exact signed group is journaled before broadcast; recovery reuses it. Existing single-call journals continue on their original path. This reduces transaction overhead and confirmation round trips without dropping any of the 663 verifier calls. The public service operator funds this computation; the QRAFT paymaster funds the wallet-authorized session and payout transactions.

## Anonymous submission headers

The browser path exposed a separate interoperability bug: browser-harness 0.4.0 serializes request headers as pairs, while the pinned Nym worker's mix-fetch path drops them. Execution RPC tolerated the missing header; the sidecar correctly rejected it with HTTP 415 (`Unsupported Media Type: undefined`). A version-checked host serialization patch converts the pairs to a plain header object. The original worker bundle, its onchain hash verification, and null-origin isolation are unchanged. Both lowercase and title-case JSON Content-Type probes then returned `0x539` through Nym. The patch runs during installation and before builds/development, and refuses unexpected upstream serializer changes.

Separate frame limits do not bypass the sidecar's transaction-wide budget (`skandha_config`: `userOpGasLimit` and `bundleGasLimit` are both 25,000,000; the execution block limit is 60,000,000). Live transcript calls consumed about 13.4 million execution gas each; two such calls cannot fit under the 25 million total budget. These remain single-call groups. The optimizer groups smaller calls where simulation permits instead of weakening proof verification.
