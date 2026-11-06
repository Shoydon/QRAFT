use qraft_direct_hiding_research::{
    blake_config::{self as bc, Config, Val},
    membership::{self, MembershipAir},
};
use p3_uni_stark::{Proof, prove_with_preprocessed, verify_with_preprocessed};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
const MAX_JSON: usize = 32768;
const MAX_PROOF: usize = 16 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Statement {
    root: Vec<u8>,
    nullifier: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Witness {
    secret: Vec<u8>,
    siblings: Vec<Vec<u8>>,
    directions: Vec<bool>,
}
fn err() -> JsValue {
    JsValue::from_str("Invalid membership input or proof")
}
fn parse<T: serde::de::DeserializeOwned>(s: &str) -> Result<T, JsValue> {
    if s.len() > MAX_JSON {
        return Err(err());
    }
    serde_json::from_str(s).map_err(|_| err())
}
fn statement(s: &str) -> Result<Vec<Val>, JsValue> {
    let s: Statement = parse(s)?;
    let r: [u8; 64] = s.root.try_into().map_err(|_| err())?;
    let n: [u8; 64] = s.nullifier.try_into().map_err(|_| err())?;
    let mut v = membership::public_root(r);
    v.extend(membership::public_root::<Val>(n));
    Ok(v)
}
fn witness(s: &str) -> Result<([u8; 64], Vec<[u8; 64]>, Vec<bool>), JsValue> {
    let w: Witness = parse(s)?;
    if w.siblings.len() != 32 || w.directions.len() != 32 {
        return Err(err());
    }
    let secret = w.secret.try_into().map_err(|_| err())?;
    let sib = w
        .siblings
        .into_iter()
        .map(|v| v.try_into().map_err(|_| err()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((secret, sib, w.directions))
}
fn air() -> MembershipAir {
    MembershipAir {
        depth: 32,
        log_rows: 11,
    }
}
#[wasm_bindgen(start)]
pub fn initialize() {
    std::panic::set_hook(Box::new(|_| {}));
}
#[wasm_bindgen]
pub fn prove(expected: &str, private: &str) -> Result<Vec<u8>, JsValue> {
    let public = statement(expected)?;
    let (secret, sib, dirs) = witness(private)?;
    let root = membership::root_and_nodes(secret, &sib, &dirs).0;
    if membership::public_values::<Val>(root, secret) != public {
        return Err(err());
    }
    let a = air();
    let (pd, _) = bc::canonical_membership_preprocessing().map_err(|_| err())?;
    let cfg = bc::membership_config();
    let proof = prove_with_preprocessed(
        &cfg,
        &a,
        membership::trace(secret, &sib, &dirs, 11, 4),
        &public,
        Some(&pd),
    )
    .map_err(|_| err())?;
    let bytes = postcard::to_allocvec(&proof).map_err(|_| err())?;
    if bytes.len() > MAX_PROOF {
        return Err(err());
    }
    Ok(bytes)
}
#[wasm_bindgen]
pub fn verify(expected: &str, bytes: &[u8]) -> Result<bool, JsValue> {
    let public = statement(expected)?;
    if bytes.is_empty() || bytes.len() > MAX_PROOF {
        return Err(err());
    }
    let (proof, rest) = postcard::take_from_bytes::<Proof<Config>>(bytes).map_err(|_| err())?;
    if !rest.is_empty() {
        return Err(err());
    }
    let a = air();
    let (_, vk) = bc::canonical_membership_preprocessing().map_err(|_| err())?;
    Ok(verify_with_preprocessed(&bc::membership_config(), &a, &proof, &public, Some(&vk)).is_ok())
}
// Generates only a fresh local diagnostic fixture; never used to infer verifier authority.
#[wasm_bindgen]
pub fn diagnostic() -> Result<String, JsValue> {
    let mut rng = rand::rng();
    let secret: [u8; 64] = rng.random();
    let sib: Vec<[u8; 64]> = (0..32).map(|_| rng.random()).collect();
    let dirs: Vec<bool> = (0..32).map(|_| rng.random()).collect();
    let root = membership::root_and_nodes(secret, &sib, &dirs).0;
    serde_json::to_string(&serde_json::json!({"statement":Statement{root:root.to_vec(),nullifier:membership::digest(&secret[..32]).to_vec()},"witness":Witness{secret:secret.to_vec(),siblings:sib.iter().map(|v|v.to_vec()).collect(),directions:dirs}})).map_err(|_|err())
}
#[wasm_bindgen]
pub fn public_vk_hex() -> Result<String, JsValue> {
    let (_, vk) = bc::canonical_membership_preprocessing().map_err(|_| err())?;
    let bytes = postcard::to_allocvec(&(vk.width as u64, vk.degree_bits as u64, &vk.commitment))
        .map_err(|_| err())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

// V3 uses the fixed withdrawal AIR and the full-prefix, public-round-salted compiler.
// The expected context digest must be derived by the application/pool from its own policy.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WithdrawalStatement {
    root: Vec<u8>,
    nullifier: Vec<u8>,
    context: Vec<u8>,
}
fn withdrawal_statement(s: &str) -> Result<(Vec<Val>, [u8; 64]), JsValue> {
    let s: WithdrawalStatement = parse(s)?;
    let r: [u8; 64] = s.root.try_into().map_err(|_| err())?;
    let n: [u8; 64] = s.nullifier.try_into().map_err(|_| err())?;
    let c: [u8; 64] = s.context.try_into().map_err(|_| err())?;
    Ok((
        qraft_direct_hiding_research::authorization::public_values::<Val>(r, n, c),
        c,
    ))
}
#[wasm_bindgen]
pub fn prove_withdrawal(expected: &str, private: &str) -> Result<Vec<u8>, JsValue> {
    use qraft_direct_hiding_research::{authorization as a, full_prefix as fp};
    let (public, context) = withdrawal_statement(expected)?;
    let (secret, siblings, directions) = witness(private)?;
    let root = membership::root_and_nodes(secret, &siblings, &directions).0;
    let nullifier = membership::digest(&secret[..32]);
    if a::public_values::<Val>(root, nullifier, context) != public {
        return Err(err());
    }
    let (cfg, log) = fp::prover_config();
    let (pd, _) = fp::canonical_preprocessing().map_err(|_| err())?;
    let proof = prove_with_preprocessed(
        &cfg,
        &a::WithdrawalAir,
        a::trace(secret, &siblings, &directions, context, 4),
        &public,
        Some(&pd),
    )
    .map_err(|_| err())?;
    fp::assert_complete(&log).map_err(|_| err())?;
    let salts = log.lock().map_err(|_| err())?.salts.clone();
    fp::Envelope { salts, proof }.to_bytes().map_err(|_| err())
}
#[wasm_bindgen]
pub fn verify_withdrawal(expected: &str, bytes: &[u8]) -> Result<bool, JsValue> {
    use qraft_direct_hiding_research::full_prefix as fp;
    let (public, _) = withdrawal_statement(expected)?;
    let envelope = fp::Envelope::from_bytes(bytes).map_err(|_| err())?;
    Ok(fp::verify_envelope(&envelope, &public).is_ok())
}
#[wasm_bindgen]
pub fn diagnostic_withdrawal() -> Result<String, JsValue> {
    let fixture: serde_json::Value = serde_json::from_str(&diagnostic()?).map_err(|_| err())?;
    let mut statement = fixture["statement"].clone();
    let mut rng = rand::rng();
    let context: [u8; 64] = rng.random();
    statement["context"] = serde_json::json!(context.to_vec());
    serde_json::to_string(&serde_json::json!({"statement":statement,"witness":fixture["witness"]}))
        .map_err(|_| err())
}

#[wasm_bindgen]
pub fn prove_withdrawal_v5(expected: &str, private: &str) -> Result<Vec<u8>, JsValue> {
    use qraft_direct_hiding_research::{
        authorization as a, strong_config as sc, strong_transcript as fp,
    };
    let (public, context) = withdrawal_statement(expected)?;
    let (secret, siblings, directions) = witness(private)?;
    let root = membership::root_and_nodes(secret, &siblings, &directions).0;
    let nullifier = membership::digest(&secret[..32]);
    if a::public_values::<Val>(root, nullifier, context) != public {
        return Err(err());
    }
    let (cfg, log) = fp::prover_config(&public).map_err(|_| err())?;
    let (pd, _) = sc::canonical_preprocessing().map_err(|_| err())?;
    let proof = prove_with_preprocessed(
        &cfg,
        &a::WithdrawalAir,
        a::trace(secret, &siblings, &directions, context, 4),
        &public,
        Some(&pd),
    )
    .map_err(|_| err())?;
    fp::assert_complete(&log).map_err(|_| err())?;
    let salt = log.lock().map_err(|_| err())?.salt;
    fp::Envelope { salt, proof }.to_bytes().map_err(|_| err())
}
#[wasm_bindgen]
pub fn verify_withdrawal_v5(expected: &str, bytes: &[u8]) -> Result<bool, JsValue> {
    use qraft_direct_hiding_research::strong_transcript as fp;
    let (public, _) = withdrawal_statement(expected)?;
    let envelope = fp::Envelope::from_bytes(bytes).map_err(|_| err())?;
    Ok(fp::verify_envelope(&envelope, &public).is_ok())
}
#[wasm_bindgen]
pub fn public_vk_v5_hex() -> Result<String, JsValue> {
    let (_, vk) = qraft_direct_hiding_research::strong_config::canonical_preprocessing()
        .map_err(|_| err())?;
    let bytes = postcard::to_allocvec(&(vk.width as u64, vk.degree_bits as u64, &vk.commitment))
        .map_err(|_| err())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
