//! Verify and export an existing PUBLIC browser V5 envelope. Never reads a witness.
use qraft_direct_hiding_research::{
    authorization::{self, WithdrawalContext},
    strong_config as bc, strong_transcript as fp,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

const PROFILE: &str = "qraft-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16";
type Error = Box<dyn std::error::Error>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Expected {
    profile: String,
    root: Vec<u8>,
    nullifier: Vec<u8>,
    context: Vec<u8>,
    public_context: PublicContext,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PublicContext {
    chain_id_hex: String,
    pool_hex: String,
    recipient_hex: String,
    relayer_hex: String,
    denomination: String,
    fee: String,
    deadline: String,
}
fn bounded(path: &Path, max: usize) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > max {
        return Err("public input size limit".into());
    }
    Ok(bytes)
}
fn fixed<const N: usize>(value: &str) -> Result<[u8; N], Error> {
    let text = value.strip_prefix("0x").unwrap_or(value);
    if !text.is_ascii() || text.len() != N * 2 {
        return Err("invalid public context encoding".into());
    }
    let mut out = [0; N];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16)
            .map_err(|_| "invalid public context encoding")?;
    }
    Ok(out)
}
fn decimal(value: &str) -> Result<u128, Error> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("invalid public context integer".into());
    }
    value
        .parse()
        .map_err(|_| "invalid public context integer".into())
}
fn context(value: &PublicContext) -> Result<WithdrawalContext, Error> {
    let result = WithdrawalContext {
        chain_id: fixed(&value.chain_id_hex)?,
        pool: fixed(&value.pool_hex)?,
        asset: [0; 20],
        denomination: decimal(&value.denomination)?,
        recipient: fixed(&value.recipient_hex)?,
        relayer: fixed(&value.relayer_hex)?,
        fee: decimal(&value.fee)?,
        deadline: u64::try_from(decimal(&value.deadline)?)
            .map_err(|_| "invalid public deadline")?,
    };
    if result.denomination == 0
        || result.fee > result.denomination
        || result.recipient == [0; 20]
        || result.recipient == result.pool
        || (result.fee != 0 && (result.relayer == [0; 20] || result.relayer == result.pool))
    {
        return Err("invalid public withdrawal policy".into());
    }
    Ok(result)
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn sha(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}
fn stringify_numbers(value: &mut Value) {
    match value {
        Value::Number(n) => *value = Value::String(n.to_string()),
        Value::Array(values) => values.iter_mut().for_each(stringify_numbers),
        Value::Object(values) => values.values_mut().for_each(stringify_numbers),
        _ => {}
    }
}
fn run() -> Result<(), Error> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 4 {
        return Err(
            "usage: export_browser_v5 PUBLIC_ENVELOPE EXPECTED_PUBLIC_JSON OUTPUT_DIR".into(),
        );
    }
    let encoded = bounded(Path::new(&args[1]), fp::MAX_ENVELOPE_BYTES)?;
    let expected_bytes = bounded(Path::new(&args[2]), 16384)?;
    let expected: Expected =
        serde_json::from_slice(&expected_bytes).map_err(|_| "invalid separate public statement")?;
    if expected.profile != PROFILE {
        return Err("unsupported public proof profile".into());
    }
    let root: [u8; 64] = expected
        .root
        .try_into()
        .map_err(|_| "invalid public root width")?;
    let nullifier: [u8; 64] = expected
        .nullifier
        .try_into()
        .map_err(|_| "invalid public nullifier width")?;
    let expected_context: [u8; 64] = expected
        .context
        .try_into()
        .map_err(|_| "invalid public context width")?;
    let ctx = context(&expected.public_context)?;
    let context_digest = ctx.digest();
    if context_digest != expected_context {
        return Err("withdrawal context does not match separate statement".into());
    }
    let public = authorization::public_values::<bc::Val>(root, nullifier, context_digest);
    let envelope = fp::Envelope::from_bytes(&encoded).map_err(|_| "invalid V5 public envelope")?;
    let started = std::time::Instant::now();
    let report = fp::verify_envelope(&envelope, &public).map_err(|_| "V5 public proof rejected")?;
    let verify_ms = started.elapsed().as_secs_f64() * 1000.;
    let (_, vk) = bc::canonical_preprocessing()?;
    let proof_bytes = postcard::to_allocvec(&envelope.proof)?;
    let public_context = json!({"chainIdHex":hex(&ctx.chain_id),"poolHex":hex(&ctx.pool),"recipientHex":hex(&ctx.recipient),"relayerHex":hex(&ctx.relayer),"denomination":ctx.denomination.to_string(),"fee":ctx.fee.to_string(),"deadline":ctx.deadline.to_string()});
    let mut fixture = json!({"publicContext":public_context,"profile":PROFILE,"proofSaltHex":hex(&envelope.salt),"expectedPublic":public,"contextDigestHex":hex(&context_digest),"rootHex":hex(&root),"nullifierHex":hex(&nullifier),"publicVk":{"width":vk.width,"degreeBits":vk.degree_bits,"commitment":vk.commitment},"proof":envelope.proof,"privateWitnessExported":false});
    stringify_numbers(&mut fixture);
    let calls:Vec<_> = report.calls.iter().map(|c| json!({"round":c.round,"inputHex":hex(&c.input),"keyHex":hex(&c.key),"streamInputHex":hex(&[c.key.as_slice(),envelope.salt.as_slice()].concat()),"streamHex":hex(&c.stream),"writebackHex":hex(&c.writeback),"consumedBytes":c.consumed})).collect();
    let summary = json!({"profile":PROFILE,"publicOnly":true,"publicEnvelope":true,"originalProverLogCompared":false,"nativeVerified":true,"expectedStatementWasSeparate":true,"contextIndependentlyDerived":true,"privateWitnessRead":false,"privateWitnessExported":false,"proofBytes":proof_bytes.len(),"envelopeBytes":encoded.len(),"publicInputCount":public.len(),"logicalMoves":fp::MOVES,"proofSaltBytes":64,"streamBytes":fp::STREAM_BYTES,"proofSha256":sha(&proof_bytes),"envelopeSha256":sha(&encoded),"expectedStatementSha256":sha(&expected_bytes),"verifyMs":verify_ms});
    // No export is created until the complete statement and proof have verified.
    let out = Path::new(&args[3]);
    fs::create_dir_all(out)?;
    if fs::read_dir(out)?.next().is_some() {
        return Err("public export output must be empty".into());
    }
    for (name, bytes) in [
        ("fixture.json", serde_json::to_vec(&fixture)?),
        ("proof.postcard", proof_bytes),
        ("envelope.postcard", encoded),
        ("transcript-hashes.json", serde_json::to_vec(&calls)?),
        ("summary.json", serde_json::to_vec_pretty(&summary)?),
    ] {
        fs::write(out.join(name), bytes)?;
    }
    println!("{summary}");
    Ok(())
}
fn main() {
    std::panic::set_hook(Box::new(|_| eprintln!("public V5 export failed")));
    if run().is_err() {
        eprintln!(
            "public V5 export rejected; check the separate statement, context, proof and output path"
        );
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn public_context() -> Value {
        json!({"chainIdHex":"00".repeat(30)+"1fcd","poolHex":"11".repeat(20),"recipientHex":"22".repeat(20),"relayerHex":"00".repeat(20),"denomination":"100000000000000","fee":"0","deadline":"1800000000"})
    }
    fn expected() -> Value {
        json!({"profile":PROFILE,"root":vec![1u8;64],"nullifier":vec![2u8;64],"context":vec![3u8;64],"publicContext":public_context()})
    }
    #[test]
    fn rejects_private_fields_at_both_json_boundaries() {
        let mut value = expected();
        value["secret"] = json!("not accepted");
        assert!(serde_json::from_value::<Expected>(value).is_err());
        let mut value = expected();
        value["publicContext"]["witness"] = json!([]);
        assert!(serde_json::from_value::<Expected>(value).is_err());
    }
    #[test]
    fn decimal_values_are_bounded_and_canonical() {
        for invalid in [
            "",
            "01",
            "-1",
            "+1",
            "1e3",
            " 1",
            "340282366920938463463374607431768211456",
        ] {
            assert!(decimal(invalid).is_err());
        }
        assert_eq!(decimal("0").unwrap(), 0);
        assert_eq!(decimal("100000000000000").unwrap(), 100000000000000);
    }
    #[test]
    fn refuses_malformed_public_policies() {
        let mut value = public_context();
        value["deadline"] = json!("18446744073709551616");
        assert!(context(&serde_json::from_value(value).unwrap()).is_err());
        let mut value = public_context();
        value["recipientHex"] = json!("00".repeat(20));
        assert!(context(&serde_json::from_value(value).unwrap()).is_err());
        let mut value = public_context();
        value["fee"] = json!("1");
        assert!(context(&serde_json::from_value(value).unwrap()).is_err());
        let mut value = public_context();
        value["denomination"] = json!("0");
        assert!(context(&serde_json::from_value(value).unwrap()).is_err());
        let mut value = public_context();
        value["recipientHex"] = json!("11".repeat(20));
        assert!(context(&serde_json::from_value(value).unwrap()).is_err());
        let mut value = public_context();
        value["fee"] = json!("1");
        value["relayerHex"] = json!("11".repeat(20));
        assert!(context(&serde_json::from_value(value).unwrap()).is_err());
    }
    #[test]
    fn hex_width_and_ascii_are_exact() {
        assert!(fixed::<20>(&"ab".repeat(19)).is_err());
        assert!(fixed::<20>(&"é".repeat(20)).is_err());
        assert_eq!(
            fixed::<20>(&format!("0x{}", "ab".repeat(20))).unwrap(),
            [0xab; 20]
        );
    }
}
