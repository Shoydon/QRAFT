use qraft_direct_hiding_research::blake_config::{
    Challenge, Config, Val, canonical_membership_preprocessing, config, fri_parameters,
    membership_config,
};
use qraft_direct_hiding_research::membership::{
    MembershipAir, WIDTH, public_values, root_and_nodes, trace,
};
use p3_air::symbolic::AirLayout;
use p3_field::coset::TwoAdicMultiplicativeCoset;
use p3_field::{Field, PrimeCharacteristicRing};
use p3_uni_stark::{
    OpeningShape, Proof, StarkSecurityParams, prove_with_preprocessed, verify_with_preprocessed,
};
use rand::RngExt;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let depth = 32;
    let log_rows = 11;
    let mut rng = rand::rng();
    let secret: [u8; 64] = rng.random();
    let siblings: Vec<[u8; 64]> = (0..depth).map(|_| rng.random()).collect();
    let directions: Vec<bool> = (0..depth).map(|_| rng.random()).collect();
    let root = root_and_nodes(secret, &siblings, &directions).0;
    let public = public_values::<Val>(root, secret);
    let air = MembershipAir { depth, log_rows };
    let cfg = membership_config();
    let (pd, vk) = canonical_membership_preprocessing()?;
    let start = Instant::now();
    let witness = trace::<Val>(secret, &siblings, &directions, log_rows, 4);
    let trace_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    let proof = prove_with_preprocessed(&cfg, &air, witness, &public, Some(&pd))?;
    let prove_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    #[cfg(feature = "hash-metrics")]
    qraft_direct_hiding_research::hash_metrics::start();
    verify_with_preprocessed(&cfg, &air, &proof, &public, Some(&vk))?;
    let verify_ms = start.elapsed().as_secs_f64() * 1000.;
    #[cfg(feature = "hash-metrics")]
    let hash_lengths = qraft_direct_hiding_research::hash_metrics::finish();

    for index in [0, 32] {
        let mut changed = public.clone();
        changed[index] += Val::ONE;
        assert!(verify_with_preprocessed(&cfg, &air, &proof, &changed, Some(&vk)).is_err());
    }
    let bytes = postcard::to_allocvec(&proof)?;
    let mut corrupted: Proof<Config> = postcard::from_bytes(&bytes)?;
    let mut roots = corrupted.commitments.trace.roots().to_vec();
    roots[0][0] ^= 1;
    corrupted.commitments.trace = roots.into();
    assert!(verify_with_preprocessed(&cfg, &air, &corrupted, &public, Some(&vk)).is_err());
    let mut wrong_key = vk.clone();
    let mut roots = wrong_key.commitment.roots().to_vec();
    roots[0][0] ^= 1;
    wrong_key.commitment = roots.into();
    assert!(verify_with_preprocessed(&cfg, &air, &proof, &public, Some(&wrong_key)).is_err());
    assert!(verify_with_preprocessed(&config(), &air, &proof, &public, Some(&vk)).is_err());
    let fri = fri_parameters(());
    let shape = StarkSecurityParams::from_air::<Val, Challenge, _>(
        fri.security_regime(),
        &air,
        AirLayout::from_air::<Val>(&air),
        TwoAdicMultiplicativeCoset::new(Val::ONE, log_rows).unwrap(),
        Challenge::bits(),
        256,
        2,
        OpeningShape::hiding(5),
        fri.grinding_sites(),
    );
    let report = serde_json::json!({
        "experimental": true,
        "relation": "private SHA3-512 secret opening, constrained nullifier and depth-32 Merkle membership; not complete withdrawal authorization",
        "upstreamCommit": "0d803737b681774186cd283b1fd2d8e493655c82",
        "leaf": "SHA3-512(secret64)", "nullifier": "SHA3-512(secret64[0..32])",
        "node": "SHA3-512(left64 || right64)", "depth":depth,
        "rows":1usize<<log_rows,"traceWidth":WIDTH,"keccakPermutations":2+2*depth,
        "proofCommitmentAndTranscriptHash":"standard BLAKE2b-512, domain-separated Merkle leaves/nodes",
        "schedule":"320 queries, blowup 16, binary folding, no proof of work; no numerical quantum-security claim",
        "validVerified":true,"changedRootRejected":true,"changedNullifierRejected":true,
        "corruptedCommitmentRejected":true,"wrongPreprocessingKeyRejected":true,
        "wrongConfigurationDomainRejected":true,"privateWitnessExported":false,
        "evmVerified":false,"applicationEnabled":false,"quantumKnowledgeSecurityEstablished":false,
        "proofBytes":bytes.len(),"traceMs":trace_ms,"proveMs":prove_ms,"verifyMs":verify_ms,
        "actualAirShape":{
            "constraintCount":shape.num_constraints,"maximumConstraintDegree":shape.air_max_constraint_degree,
            "quotientChunkCount":shape.num_quotient_chunks,"batchedFunctionCount":shape.num_batched_functions,
            "mainWidth":WIDTH,"preprocessedWidth":6,"committedDegreeBits":proof.degree_bits,
            "observedQuotientChunkCount":proof.opened_values.quotient_chunks.len()
        }
    });
    #[cfg(feature = "hash-metrics")]
    let report = {
        let mut report = report;
        report["verificationHashInputLengths"] = serde_json::to_value(hash_lengths)?;
        report
    };
    std::fs::create_dir_all("benchmark-results")?;
    std::fs::write(
        "benchmark-results/membership-blake-report.json",
        serde_json::to_vec_pretty(&report)?,
    )?;
    std::fs::write("benchmark-results/membership-blake.proof", bytes)?;
    println!("{report}");
    Ok(())
}
