//! Public-only genuine v4 full-prefix/native differential export. No witness serialized.
use qraft_direct_hiding_research::{
    authorization::{self, WithdrawalAir, WithdrawalContext},
    full_prefix_v4 as fp, indexed_config as bc, membership,
};
use p3_field::PrimeCharacteristicRing;
use p3_uni_stark::prove_with_preprocessed;
use rand::RngExt;
use serde_json::{Value, json};
fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(2 * bytes.len());
    for b in bytes {
        use std::fmt::Write;
        write!(&mut s, "{b:02x}").unwrap();
    }
    s
}
fn stringify_numbers(value: &mut Value) {
    match value {
        Value::Number(n) => *value = Value::String(n.to_string()),
        Value::Array(v) => {
            for x in v {
                stringify_numbers(x)
            }
        }
        Value::Object(v) => {
            for x in v.values_mut() {
                stringify_numbers(x)
            }
        }
        _ => {}
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or("benchmark-results/evm-v4".into());
    let out = std::path::Path::new(&out);
    std::fs::create_dir_all(out)?;
    let mut rng = rand::rng();
    let secret: [u8; 64] = rng.random();
    let siblings: Vec<[u8; 64]> = (0..32).map(|_| rng.random()).collect();
    let dirs: Vec<bool> = (0..32).map(|_| rng.random()).collect();
    let mut chain_id = [0; 32];
    chain_id[30..].copy_from_slice(&1337_u16.to_be_bytes());
    let ctx = WithdrawalContext {
        chain_id,
        pool: [1; 20],
        asset: [0; 20],
        denomination: 100_000_000_000_000,
        recipient: [2; 20],
        relayer: [3; 20],
        fee: 0,
        deadline: 1_800_000_000,
    };
    let context = ctx.digest();
    let root = membership::root_and_nodes(secret, &siblings, &dirs).0;
    let nul = membership::digest(&secret[..32]);
    let public = authorization::public_values::<bc::Val>(root, nul, context);
    let (cfg, prover_log) = fp::prover_config();
    let (pd, vk) = fp::canonical_preprocessing()?;
    let start = std::time::Instant::now();
    let proof = prove_with_preprocessed(
        &cfg,
        &WithdrawalAir,
        authorization::trace(secret, &siblings, &dirs, context, 4),
        &public,
        Some(&pd),
    )?;
    let prove_ms = start.elapsed().as_secs_f64() * 1000.;
    fp::assert_complete(&prover_log)?;
    let salts = prover_log.lock().unwrap().salts.clone();
    let envelope = fp::Envelope { salts, proof };
    let encoded = envelope.to_bytes()?;
    std::fs::write(out.join("envelope.postcard"), &encoded)?;
    let envelope = fp::Envelope::from_bytes(&encoded)?;
    let mut trailing = encoded.clone();
    trailing.push(0);
    assert!(fp::Envelope::from_bytes(&trailing).is_err());
    let mut nonminimal = vec![0x90, 0];
    nonminimal.extend_from_slice(&encoded[1..]);
    assert!(fp::Envelope::from_bytes(&nonminimal).is_err());
    assert!(fp::Envelope::from_bytes(&vec![0; fp::MAX_ENVELOPE_BYTES + 1]).is_err());
    let verify_start = std::time::Instant::now();
    let verifier = fp::verify_envelope(&envelope, &public)?;
    let verify_ms = verify_start.elapsed().as_secs_f64() * 1000.;
    assert_eq!(
        prover_log.lock().unwrap().calls,
        verifier.calls,
        "prover/verifier full raw-input parity"
    );
    let mut mutation_results = vec![];
    for (index, name) in [(0, "root"), (32, "nullifier"), (64, "context")] {
        let mut changed = public.clone();
        changed[index] += bc::Val::ONE;
        let rejected = fp::verify_envelope(&envelope, &changed).is_err();
        assert!(rejected);
        mutation_results.push(json!({"type":name,"rejected":rejected}));
    }
    for round in 0..fp::MOVES {
        let saved = envelope.salts[round][0];
        let mut changed = fp::Envelope {
            salts: envelope.salts.clone(),
            proof: postcard::from_bytes(&postcard::to_allocvec(&envelope.proof)?)?,
        };
        changed.salts[round][0] = saved ^ 1;
        assert!(
            fp::verify_envelope(&changed, &public).is_err(),
            "salt{round} alteration accepted"
        );
    }
    let mut fewer = fp::Envelope {
        salts: envelope.salts.clone(),
        proof: postcard::from_bytes(&postcard::to_allocvec(&envelope.proof)?)?,
    };
    fewer.salts.pop();
    assert!(fp::verify_envelope(&fewer, &public).is_err());
    for role in 0..16 {
        let mut changed = fp::Envelope::from_bytes(&encoded)?;
        match role {
            0 => changed.proof.commitments.trace.idx = 0,
            1 => changed.proof.commitments.quotient_chunks.idx = 1,
            2 => changed.proof.commitments.random.as_mut().unwrap().idx = 2,
            3..=14 => changed.proof.opening_proof.1.commit_phase_commits[role - 3].idx = 3,
            _ => changed.proof.opening_proof.1.commit_phase_commits[0].idx = 16,
        }
        assert!(
            fp::verify_envelope(&changed, &public).is_err(),
            "v4 wrong/duplicate/out-of-range index accepted"
        );
    }
    let encoded_proof = postcard::to_allocvec(&envelope.proof)?;
    std::fs::write(out.join("proof.postcard"), &encoded_proof)?;
    let mut fixture = json!({"profile":"qraft-withdrawal-v4-full-prefix-indexed-blake2b512-goldilocks5-q320-b16","publicSalts":envelope.salts,"expectedPublic":public,"contextDigestHex":hex(&context),"rootHex":hex(&root),"nullifierHex":hex(&nul),"publicVk":{"width":vk.width,"degreeBits":vk.degree_bits,"commitment":vk.commitment},"proof":envelope.proof,"privateWitnessExported":false});
    stringify_numbers(&mut fixture);
    std::fs::write(out.join("fixture.json"), serde_json::to_vec(&fixture)?)?;
    let calls:Vec<_>=verifier.calls.iter().map(|c|json!({"round":c.round,"block":c.block,"inputHex":hex(&c.input),"outputHex":hex(&c.output)})).collect();
    std::fs::write(
        out.join("transcript-hashes.json"),
        serde_json::to_vec(&calls)?,
    )?;
    let summary = json!({"experimental":true,"fullEvmVerification":false,"privateWitnessExported":false,"proofBytes":encoded_proof.len(),"envelopeBytes":encoded.len(),"publicInputCount":public.len(),"traceWidth":authorization::WIDTH,"publicSaltCount":envelope.salts.len(),"privateCommitmentIndices":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"leafSaltFieldElements":16,"privateIndexMutationsRejected":true,"logicalMoves":fp::MOVES,"transcriptHashCalls":calls.len(),"maxBlocksPerMove":fp::BLOCKS_PER_MOVE,"proveMs":prove_ms,"verifyMs":verify_ms,"nativeVerified":true,"rawProverVerifierParity":true,"all16SaltsUsed":true,"all16SaltMutationsRejected":true,"missingSaltRejected":true,"trailingEnvelopeRejected":true,"nonminimalEnvelopeRejected":true,"oversizeEnvelopeRejected":true,"publicInputMutations":mutation_results});
    std::fs::write(
        out.join("summary.json"),
        serde_json::to_vec_pretty(&summary)?,
    )?;
    println!("{summary}");
    Ok(())
}
