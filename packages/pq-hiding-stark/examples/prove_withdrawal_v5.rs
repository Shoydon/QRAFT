//! Prove an actual deposit withdrawal with the v5 spBCS compiler from a local private input file. Outputs are public only.
use himitsu_direct_hiding_research::{
    authorization::{self, WithdrawalAir, WithdrawalContext},
    membership, strong_config as bc, strong_transcript as fp,
};
use p3_field::PrimeCharacteristicRing;
use p3_uni_stark::prove_with_preprocessed;

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
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        return Err("usage: prove_withdrawal PRIVATE_INPUT_JSON PUBLIC_OUTPUT_DIR".into());
    }
    let input_path = std::path::Path::new(&args[1]);
    if std::fs::metadata(input_path)?.len() > 65536 {
        return Err("private input too large".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(input_path)?.permissions().mode() & 0o077 != 0 {
            return Err("private input must have0600 permissions".into());
        }
    }
    let raw = std::fs::read(input_path)?;
    let input: Value = serde_json::from_slice(&raw).map_err(|_| "invalid private input JSON")?;
    let object = input.as_object().ok_or("invalid private input")?;
    let allowed = [
        "secretHex",
        "siblingsHex",
        "directions",
        "chainIdHex",
        "poolHex",
        "recipientHex",
        "relayerHex",
        "denomination",
        "fee",
        "deadline",
    ];
    if object.len() != allowed.len() || object.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err("unexpected or missing private input field".into());
    }
    fn fixed<const N: usize>(v: &Value) -> Result<[u8; N], Box<dyn std::error::Error>> {
        let s = v.as_str().ok_or("invalid hex field")?;
        let s = s.strip_prefix("0x").unwrap_or(s);
        if !s.is_ascii() || s.len() != N * 2 {
            return Err("wrong hex field width".into());
        }
        let mut out = [0; N];
        for (i, b) in out.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|_| "invalid hex field")?;
        }
        Ok(out)
    }
    fn decimal(v: &Value) -> Result<u128, Box<dyn std::error::Error>> {
        Ok(v.as_str()
            .ok_or("decimal field must be a string")?
            .parse()
            .map_err(|_| "invalid decimal field")?)
    }
    let secret: [u8; 64] = fixed(&input["secretHex"])?;
    let siblings: Vec<[u8; 64]> = input["siblingsHex"]
        .as_array()
        .ok_or("invalid Merkle path")?
        .iter()
        .map(fixed)
        .collect::<Result<_, _>>()?;
    let dirs: Vec<bool> = input["directions"]
        .as_array()
        .ok_or("invalid directions")?
        .iter()
        .map(|v| v.as_bool().ok_or("invalid direction"))
        .collect::<Result<_, _>>()?;
    if siblings.len() != 32 || dirs.len() != 32 {
        return Err("expected depth32 path".into());
    }
    let ctx = WithdrawalContext {
        chain_id: fixed(&input["chainIdHex"])?,
        pool: fixed(&input["poolHex"])?,
        asset: [0; 20],
        denomination: decimal(&input["denomination"])?,
        recipient: fixed(&input["recipientHex"])?,
        relayer: fixed(&input["relayerHex"])?,
        fee: decimal(&input["fee"])?,
        deadline: u64::try_from(decimal(&input["deadline"])?)?,
    };
    if ctx.fee > ctx.denomination || ctx.denomination == 0 {
        return Err("invalid denomination or fee".into());
    }
    let out = std::path::Path::new(&args[2]);
    std::fs::create_dir_all(out)?;
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
    let mut fixture = json!({"publicContext":{"chainIdHex":hex(&ctx.chain_id),"poolHex":hex(&ctx.pool),"recipientHex":hex(&ctx.recipient),"relayerHex":hex(&ctx.relayer),"denomination":ctx.denomination.to_string(),"fee":ctx.fee.to_string(),"deadline":ctx.deadline.to_string()},"profile":"himitsu-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16","proofSaltHex":hex(&envelope.salt),"expectedPublic":public,"contextDigestHex":hex(&context),"rootHex":hex(&root),"nullifierHex":hex(&nul),"publicVk":{"width":vk.width,"degreeBits":vk.degree_bits,"commitment":vk.commitment},"proof":envelope.proof,"privateWitnessExported":false});
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
