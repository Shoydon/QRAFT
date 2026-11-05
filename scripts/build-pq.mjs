import { buildPublicProofEncoder } from './prepare-pq-public-proof.mjs';
try { await buildPublicProofEncoder(); console.log('Built the pinned public-only V5 encoder. No witness, signing key or RPC was used.'); }
catch(error){console.error(error.message);process.exitCode=1;}
