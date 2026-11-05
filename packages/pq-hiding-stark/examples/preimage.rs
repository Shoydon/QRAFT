use himitsu_direct_hiding_research::config::{
    Challenge, Config, Val, config, fri_parameters, membership_config,
};
use himitsu_direct_hiding_research::{Sha3PreimageAir, public_digest, trace};
use p3_air::symbolic::AirLayout;
use p3_field::coset::TwoAdicMultiplicativeCoset;
use p3_field::{Field, PrimeCharacteristicRing};
use p3_uni_stark::{
    OpeningShape, Proof, StarkSecurityParams, prove_with_preprocessed, setup_preprocessed,
    verify_with_preprocessed,
};
use rand::RngExt;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = config();
    let air = Sha3PreimageAir { log_rows: 10 };
    let secret: [u8; 32] = rand::rng().random();
    let public = public_digest::<Val>(secret);
    let (pd, vk) = setup_preprocessed(&cfg, &air, air.log_rows)?.unwrap();
    let start = Instant::now();
    let proof = prove_with_preprocessed(
        &cfg,
        &air,
        trace(secret, air.log_rows, 4),
        &public,
        Some(&pd),
    )?;
    let prove_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    #[cfg(feature = "hash-metrics")]
    himitsu_direct_hiding_research::hash_metrics::start();
    verify_with_preprocessed(&cfg, &air, &proof, &public, Some(&vk))?;
    let verify_ms = start.elapsed().as_secs_f64() * 1000.;
    #[cfg(feature = "hash-metrics")]
    let hash_lengths = himitsu_direct_hiding_research::hash_metrics::finish();

    let mut changed = public.clone();
    changed[0] += Val::ONE;
    assert!(verify_with_preprocessed(&cfg, &air, &proof, &changed, Some(&vk)).is_err());
    let other = public_digest::<Val>(rand::rng().random());
    assert!(verify_with_preprocessed(&cfg, &air, &proof, &other, Some(&vk)).is_err());
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
    assert!(
        verify_with_preprocessed(&membership_config(), &air, &proof, &public, Some(&vk)).is_err()
    );
    let fresh = prove_with_preprocessed(
        &cfg,
        &air,
        trace(secret, air.log_rows, 4),
        &public,
        Some(&pd),
    )?;
    verify_with_preprocessed(&cfg, &air, &fresh, &public, Some(&vk))?;
    assert_ne!(proof.commitments.trace, fresh.commitments.trace);
    let fri = fri_parameters(());
    let shape = StarkSecurityParams::from_air::<Val, Challenge, _>(
        fri.security_regime(),
        &air,
        AirLayout::from_air::<Val>(&air),
        TwoAdicMultiplicativeCoset::new(Val::ONE, air.log_rows).unwrap(),
        Challenge::bits(),
        256,
        2,
        OpeningShape::hiding(5),
        fri.grinding_sites(),
    );
    let report = serde_json::json!({
        "experimental": true,
        "relation": "knowledge of a 32-byte SHA3-512 preimage; not a withdrawal proof",
        "upstreamCommit": "0d803737b681774186cd283b1fd2d8e493655c82",
        "rows": 1usize << air.log_rows,
        "hash": "SHA3-512 for public digest, both hiding commitments and proof transcript",
        "challenge": "Goldilocks degree-five extension",
        "schedule": "320 queries, blowup 16, binary folding, no proof of work; no numerical quantum-security claim",
        "validVerified": true,
        "changedDigestRejected": true,
        "differentSecretDigestRejected": true,
        "corruptedCommitmentRejected": true,
        "freshMaskCommitmentDiffers": true,
        "wrongPreprocessingKeyRejected": true,
        "wrongConfigurationDomainRejected": true,
        "actualAirShape": {
            "constraintCount": shape.num_constraints,
            "maximumConstraintDegree": shape.air_max_constraint_degree,
            "quotientChunkCount": shape.num_quotient_chunks,
            "batchedFunctionCount": shape.num_batched_functions,
            "mainWidth": AirLayout::from_air::<Val>(&air).main_width,
            "preprocessedWidth": 1,
            "committedDegreeBits": proof.degree_bits,
            "observedQuotientChunkCount": proof.opened_values.quotient_chunks.len(),
        },
        "proofBytes": bytes.len(), "proveMs": prove_ms, "verifyMs": verify_ms,
        "privateWitnessExported": false, "evmVerified": false,
        "quantumKnowledgeSecurityEstablished": false,
    });
    #[cfg(feature = "hash-metrics")]
    let report = {
        let mut report = report;
        report["verificationHashInputLengths"] = serde_json::to_value(hash_lengths)?;
        report
    };
    std::fs::create_dir_all("benchmark-results")?;
    std::fs::write(
        "benchmark-results/preimage-report.json",
        serde_json::to_vec_pretty(&report)?,
    )?;
    std::fs::write("benchmark-results/preimage.proof", bytes)?;
    println!("{report}");
    Ok(())
}
