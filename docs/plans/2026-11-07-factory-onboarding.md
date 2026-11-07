# Factory onboarding implementation plan

Goal: remove the separately deployed bootstrap account. The user approved factory-directed native frames and paymaster-funded gas plus stake.

Architecture: PrivateWalletFactory is both deterministic clone factory and EIP-8141 setup sender. Its VERIFY frame binds the prepared PQ key, setup calldata, sponsor, fee limits and per-key nonce lane, calling the existing ML-DSA verifier. The execution frame creates the clone and atomically requests 0.012 ETH from the paymaster, then stakes the account. Paymaster funding is restricted to this factory in its native execution frame, once per commitment. No application relay or backwards compatibility.

Alternatives: keep a separate bootstrap (rejected by user); put setup authorization in the factory (selected). Keep shared proof sender for private payments, as exposing each user's public account would defeat its purpose.

1. Replace PrivateBootstrapAccount with PrivateWalletFactory: inline canonical CREATE2 init code and prediction; one-time initialize implementation/validator/paymaster; preserve PQ authorization and replay checks.
2. Restrict wallet staking to factory; add paymaster stake funding restricted to factory, transaction sender and execution frame. Atomically roll back deployment and funding on error.
3. Rename frontend frame builder to privateFactoryPlan, use factory sender, update deployment schema and checks. Add frame tests for sender/targets/nonce and native negative funding tests.
4. Update native compilation, deployment v4, initialization/staking and fund paymaster generously. Nine shared contracts, no bootstrap pin.
5. Compile, run unit tests, native simulation and real setup/deposit/send/withdrawal, build frontend and run real Nym browser E2E including recovery. Update inventory, deck and verification evidence only after passing.
