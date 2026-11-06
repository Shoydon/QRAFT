//! Verify public v5 bytes against a SEPARATE caller-provided statement. No witness IO.
use qraft_direct_hiding_research::{authorization, strong_config as bc, strong_transcript as fp};
use serde::Deserialize;
use sha2::{Digest, Sha256};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Statement {
    root: Vec<u8>,
    nullifier: Vec<u8>,
    context: Vec<u8>,
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    std::panic::set_hook(Box::new(|_| eprintln!("v5 public verification failed")));
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        return Err("usage: verify_public_v5 PUBLIC_PROOF SEPARATE_EXPECTED_STATEMENT_JSON".into());
    }
    let n = std::fs::metadata(&args[1])?.len();
    if n == 0 || n > fp::MAX_ENVELOPE_BYTES as u64 || std::fs::metadata(&args[2])?.len() > 16384 {
        return Err("public input size limit".into());
    }
    let bytes = std::fs::read(&args[1])?;
    let expected: Statement = serde_json::from_slice(&std::fs::read(&args[2])?)
        .map_err(|_| "invalid expected statement")?;
    let root: [u8; 64] = expected.root.try_into().map_err(|_| "invalid root width")?;
    let nul: [u8; 64] = expected
        .nullifier
        .try_into()
        .map_err(|_| "invalid nullifier width")?;
    let ctx: [u8; 64] = expected
        .context
        .try_into()
        .map_err(|_| "invalid context width")?;
    let public = authorization::public_values::<bc::Val>(root, nul, ctx);
    let envelope = fp::Envelope::from_bytes(&bytes).map_err(|_| "invalid public proof encoding")?;
    let start = std::time::Instant::now();
    fp::verify_envelope(&envelope, &public).map_err(|_| "v5 public proof rejected")?;
    let hash: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    println!(
        "{}",
        serde_json::json!({"verified":true,"expectedStatementWasSeparate":true,"proofBytes":bytes.len(),"proofSha256":hash,"verifyMs":start.elapsed().as_secs_f64()*1000.,"privateWitnessRead":false})
    );
    Ok(())
}
