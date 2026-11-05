//! Public-only genuine v5 two-layer-stream/write-back experiment. No witness serialized.
use himitsu_direct_hiding_research::{
    authorization::{self, WithdrawalAir, WithdrawalContext},
    membership, strong_config as bc, strong_transcript as fp,
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
    std::panic::set_hook(Box::new(|_| eprintln!("v5 operation failed")));
    let out = std::env::args()
        .nth(1)
        .unwrap_or("benchmark-results/evm-v5".into());
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
    let (cfg, prover_log) = fp::prover_config(&public)?;
    let (pd, vk) = bc::canonical_preprocessing()?;
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
    let salt = prover_log.lock().unwrap().salt;
    let envelope = fp::Envelope { salt, proof };
    let encoded = envelope.to_bytes()?;
    std::fs::write(out.join("envelope.postcard"), &encoded)?;
    let envelope = fp::Envelope::from_bytes(&encoded)?;
    let mut nonminimal = encoded[..72].to_vec();
    assert!(encoded[72] < 128);
    nonminimal.extend([encoded[72] | 128, 0]);
    nonminimal.extend_from_slice(&encoded[73..]);
    assert!(fp::Envelope::from_bytes(&nonminimal).is_err());
    let mut trailing = encoded.clone();
    trailing.push(0);
    assert!(fp::Envelope::from_bytes(&trailing).is_err());
    assert!(fp::Envelope::from_bytes(&encoded[..71]).is_err());
    let mut wrong_magic = encoded.clone();
    wrong_magic[0] ^= 1;
    assert!(fp::Envelope::from_bytes(&wrong_magic).is_err());
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
    let mut changed = fp::Envelope {
        salt: envelope.salt,
        proof: postcard::from_bytes(&postcard::to_allocvec(&envelope.proof)?)?,
    };
    changed.salt[0] ^= 1;
    assert!(fp::verify_envelope(&changed, &public).is_err());
    let encoded_proof = postcard::to_allocvec(&envelope.proof)?;
    std::fs::write(out.join("proof.postcard"), &encoded_proof)?;
    let mut fixture = json!({"profile":"himitsu-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16","proofSaltHex":hex(&envelope.salt),"expectedPublic":public,"contextDigestHex":hex(&context),"rootHex":hex(&root),"nullifierHex":hex(&nul),"publicVk":{"width":vk.width,"degreeBits":vk.degree_bits,"commitment":vk.commitment},"proof":envelope.proof,"privateWitnessExported":false});
    stringify_numbers(&mut fixture);
    std::fs::write(out.join("fixture.json"), serde_json::to_vec(&fixture)?)?;
    let calls:Vec<_>=verifier.calls.iter().map(|c|json!({"round":c.round,"inputHex":hex(&c.input),"keyHex":hex(&c.key),"streamInputHex":hex(&[c.key.as_slice(),envelope.salt.as_slice()].concat()),"streamHex":hex(&c.stream),"writebackHex":hex(&c.writeback),"consumedBytes":c.consumed})).collect();
    std::fs::write(
        out.join("transcript-hashes.json"),
        serde_json::to_vec(&calls)?,
    )?;
    let summary = json!({"experimental":true,"fullEvmVerification":false,"compilerMappingEstablished":false,"custodySecurityEstablished":false,"privateWitnessExported":false,"proofBytes":encoded_proof.len(),"envelopeBytes":encoded.len(),"publicInputCount":public.len(),"traceWidth":authorization::WIDTH,"proofSaltBytes":64,"logicalMoves":fp::MOVES,"streamBytes":fp::STREAM_BYTES,"nativeVerified":true,"rawProverVerifierParity":true,"proofSaltMutationRejected":true,"trailingEnvelopeRejected":true,"wrongMagicRejected":true,"nonminimalEncodingRejected":true,"truncatedSaltRejected":true,"oversizeEnvelopeRejected":true,"publicInputMutations":mutation_results,"proveMs":prove_ms,"verifyMs":verify_ms});
    std::fs::write(
        out.join("summary.json"),
        serde_json::to_vec_pretty(&summary)?,
    )?;
    println!("{summary}");
    Ok(())
}
