# Outstanding sidecar compatibility

A fresh staked ML-DSA-44 account on chain 1337 passed execution simulation for a three-frame, paymaster-sponsored deposit. Sidecar admission rejected OP-011 with `sender uses banned opcode: GAS`.

- Transaction: `0xdd98edef75ab9a306031fb9756e56f4ef341c88a932991e8a4e5d09ce35eab2b`
- Sender: `0xb7B255eC611F4A936921E6C5d45383294Dd8b2CD`
- Endpoint: `https://altmempool.forshtat.com/rpc`
- [Public admission report](alt-mempool-admission.json)
- [Sidecar validator source](https://github.com/forshtat/mempool-workshop-sidecar/blob/master/packages/executor/src/services/UserOpValidation/validators/frameTx.ts)

The validator's banned-opcode set includes GAS without a call-forwarding exception at the enforcement point. The account uses an immutable-argument delegatecall clone and Solidity call forwarding. Determine whether the execution trace should omit GAS immediately followed by CALL-family instructions, or whether this devnet intentionally requires an account and verifier with fixed gas forwarding. Do not whitelist entities, bypass admission, or represent direct submission as alternative-mempool success.

Suggested question for the EF team (not sent):

> On chain 1337, our staked PQ sender passes frame simulation but sidecar OP-011 rejects GAS. Does the deployed tracer/sidecar support the GAS-immediately-before-CALL exception for clone and Solidity call forwarding? Rejected hash: 0xdd98edef75ab9a306031fb9756e56f4ef341c88a932991e8a4e5d09ce35eab2b. Which revision or supported pattern should we target?

The current manifest deliberately disables new transactions. Resolve admission, run sponsored PQ deposit and complete withdrawal tests, and deploy the remaining denominations before marking the migration complete.
