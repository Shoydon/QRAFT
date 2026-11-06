# Application security boundaries

## Active atomic profile

Wallet signatures are ML-DSA-44. Withdrawal proofs are **conventional Groth16 over BN254**, using the existing development setup and depth-10 Poseidon circuit. Neither the withdrawal proof nor the note/tree system is claimed post-quantum. This was the explicitly approved fallback after the previous PQ verifier proved impractical for a single transaction. See [feasibility](atomic-feasibility.md).

The shared signature verifier checks the full ML-DSA equations and SHAKE256. The account commits to prepared public verification data and binds its signature to the native transaction signing hash. Prepared data must be generated from a genuine key; the client applies the pinned upstream preparation and degenerate-key rejection. A malicious creator choosing its own weak key compromises its own account, not another account's key commitment. The adapted verifier is research code without an independent audit.

The pool verifies membership and ownership, derives the complete public digest including chain, pool, amount, root, nullifier, recipient, expiry and zero fee, and pays atomically. Failed proof/payout reverts the spent flag. A note is a bearer credential. The recipient may be an EOA; subsequent custody then depends on the recipient's own signature scheme.

The paymaster only approves the fixed three-frame shape and recognized factory accounts, bounded fees/gas, and pool deposit/withdraw calls. It does not authorize execution; the ML-DSA account does. Sponsorship is intentionally a bounded public devnet service, not an economic Sybil defense. Only the operator can withdraw sponsor funds. Account staking has no key-management authority.

Private seeds are browser-local and encrypted at rest by AES-GCM with WebAuthn PRF/HKDF. An unlocked compromised origin can access signing material; passkeys do not prevent malicious application JavaScript. Notes and proof witnesses are local. A journal retains exact signed bytes before submission. An uncertain response is reconciled using that same transaction, never an automatically different withdrawal.

Nym hides the browser IP from the destination RPC; the destination still sees requests. Worker discovery is direct. Public account creation is performed by a funded server operator and is linkable to that server. Neither Ethereum consensus, Nym transport, nor the conventional proof inherits ML-DSA's security properties. Alternative-mempool admission is not a substitute for final receipt checks.

## Historical V5 scope

Historical notes use the separate transparent V5/SHA3-512 design documented in [the V5 security argument](pq-v5-security-argument.md). That research construction and its conditional claims are not the active atomic proof profile. Old deployment/proof artifacts and incomplete runs are retained for recovery and provenance.
