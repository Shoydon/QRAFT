# Source attribution and licensing

QRAFT includes implementation from an upstream research project. The native frame codec, ML-DSA public-key preparation, and V5 transparent proof implementation were imported from that source. The interface integration, local public helper, recovery checks, and deployment validation are implemented in QRAFT. This attribution records implementation provenance, rather than a claim of inspiration or a statement that all code was written from scratch.

The historical circuit, verifier, proving artifacts and tree attribution are documented in [protocol/README.md](protocol/README.md). The verifier retains its GPL-3.0 notice and [license text](protocol/COPYING.verifier). MIT license notices remain applicable to their respective source files.

Dependency sources and pinned revisions are recorded in the package provenance files, including the ERC-8286 reference account and ML-DSA verifier. Preserve their license notices when redistributing the corresponding code. The QRAFT namespace changes cryptographic domain strings, proof profiles and generated binding identifiers. Earlier deployment pins are historical; compatible contracts must be deployed and verified before transactions are enabled.
