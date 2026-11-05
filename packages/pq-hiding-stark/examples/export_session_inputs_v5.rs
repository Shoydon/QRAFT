//! Public-only native Cargo example. Uses pinned package dependencies, not a hosted script service.
use himitsu_direct_hiding_research::strong_config::{
    Compress, FieldHash, LeafHash, NodeHash, Val, ValMmcs,
};
use p3_commit::Mmcs;
use p3_field::{PrimeCharacteristicRing, PrimeField64};
use p3_matrix::Dimensions;
use p3_merkle_tree::{MerkleCap, MerkleTreeMmcs, PrunedMerklePaths};
use rand::{SeedableRng, rngs::StdRng};
use serde_json::{Value, json};
use sha2::Digest;
fn num(v: &Value) -> u64 {
    v.as_u64()
        .unwrap_or_else(|| v.as_str().unwrap().parse().unwrap())
}
fn digest(v: &Value) -> [u64; 8] {
    std::array::from_fn(|i| num(&v[i]))
}
fn hex(bytes: impl IntoIterator<Item = u8>) -> String {
    bytes.into_iter().map(|v| format!("{v:02x}")).collect()
}
fn dh(d: &[u64; 8]) -> String {
    hex(d.iter().flat_map(|v| v.to_le_bytes()))
}
fn words(row: &[Val]) -> String {
    hex(row.iter().flat_map(|v| v.as_canonical_u64().to_le_bytes()))
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
fn verify_source(
    directory: &std::path::Path,
    fixture: &Value,
    challenges: &Value,
) -> Result<String, Box<dyn std::error::Error>> {
    use himitsu_direct_hiding_research::strong_transcript as fp;
    let proof_bytes = std::fs::read(directory.join("proof.postcard"))?;
    let envelope = fp::Envelope::from_bytes(&std::fs::read(directory.join("envelope.postcard"))?)?;
    assert_eq!(
        postcard::to_allocvec(&envelope.proof)?,
        proof_bytes,
        "public proof/envelope mismatch"
    );
    let mut actual = serde_json::to_value(&envelope.proof)?;
    let mut supplied = fixture["proof"].clone();
    stringify_numbers(&mut actual);
    stringify_numbers(&mut supplied);
    assert_eq!(actual, supplied, "fixture/proof mismatch");
    let salt_hex = fixture["proofSaltHex"]
        .as_str()
        .unwrap()
        .trim_start_matches("0x");
    assert_eq!(salt_hex.len(), 128);
    let supplied_salt: Vec<u8> = (0..128)
        .step_by(2)
        .map(|i| u8::from_str_radix(&salt_hex[i..i + 2], 16).unwrap())
        .collect();
    assert_eq!(supplied_salt, envelope.salt);
    let public: Vec<Val> = fixture["expectedPublic"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            let n = num(v);
            assert!(n < 18446744069414584321);
            Val::new(n)
        })
        .collect();
    let report = fp::verify_envelope(&envelope, &public)?;
    let mut streams: Vec<Vec<u8>> = vec![vec![]; 16];
    assert_eq!(report.calls.len(), 16);
    for (r, call) in report.calls.iter().enumerate() {
        assert_eq!(call.round, r as u32);
        assert_eq!(call.stream.len(), 2560);
        streams[r].extend(call.stream.iter().rev().copied());
    }
    for r in 0..15 {
        let mut coefficients = vec![];
        for bytes in streams[r].chunks_exact(8) {
            let value = u64::from_le_bytes(bytes.try_into().unwrap());
            if value < 18446744069414584321 {
                coefficients.push(value);
            }
            if coefficients.len() == 5 {
                break;
            }
        }
        assert_eq!(coefficients.len(), 5);
        let claimed = match r {
            0 => &challenges["alpha"],
            1 => &challenges["zeta"],
            2 => challenges.get("batchAlpha").unwrap_or(&challenges["gamma"]),
            _ => &challenges["betas"][r - 3],
        };
        let claimed: Vec<u64> = claimed.as_array().unwrap().iter().map(num).collect();
        assert_eq!(coefficients, claimed, "challenge mismatch atmove{r}");
    }
    let indices: Vec<u64> = streams[15]
        .chunks_exact(8)
        .take(320)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()) & 65535)
        .collect();
    let claimed: Vec<u64> = challenges["indices"]
        .as_array()
        .unwrap()
        .iter()
        .map(num)
        .collect();
    assert_eq!(indices.len(), 320);
    assert_eq!(indices, claimed, "joint query vector mismatch");
    Ok(format!("{:x}", sha2::Sha256::digest(&proof_bytes)))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or(".local/pq-v5-native".into()),
    );
    let challenge_path = std::env::args()
        .nth(2)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| input.join("challenges.json"));
    let fixture_bytes = std::fs::read(input.join("fixture.json"))?;
    let source_fixture_sha256 = format!("{:x}", sha2::Sha256::digest(&fixture_bytes));
    let f: Value = serde_json::from_slice(&fixture_bytes)?;
    let c: Value = serde_json::from_slice(&std::fs::read(&challenge_path)?)?;
    let source_proof_sha256 = verify_source(&input, &f, &c)?;
    let indices: Vec<usize> = c["indices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| num(v) as usize)
        .collect();
    assert_eq!(indices.len(), 320);
    let fri = &f["proof"]["opening_proof"][1];
    let mut batches = vec![];
    let mmcs = ValMmcs::new(
        FieldHash::new(LeafHash),
        Compress::new(NodeHash),
        0,
        StdRng::from_seed([0; 32]),
    );
    let inner = MerkleTreeMmcs::<Val, u64, _, _, 2, 8>::new(
        FieldHash::new(LeafHash),
        Compress::new(NodeHash),
        0,
    );
    for batch in 0..4 {
        let opening = &fri["input_openings"][batch];
        let rows: Vec<Vec<Vec<Val>>> = opening["opened_values"]
            .as_array()
            .unwrap()
            .iter()
            .map(|q| {
                q.as_array()
                    .unwrap()
                    .iter()
                    .map(|m| {
                        m.as_array()
                            .unwrap()
                            .iter()
                            .map(|v| Val::from_u64(num(v)))
                            .collect()
                    })
                    .collect()
            })
            .collect();
        let salts: Vec<Vec<Vec<Val>>> = opening["opening_proof"][0]
            .as_array()
            .unwrap()
            .iter()
            .map(|q| {
                q.as_array()
                    .unwrap()
                    .iter()
                    .map(|m| {
                        m.as_array()
                            .unwrap()
                            .iter()
                            .map(|v| Val::from_u64(num(v)))
                            .collect()
                    })
                    .collect()
            })
            .collect();
        let nodes: Vec<_> = opening["opening_proof"][1]["sibling_hashes"]
            .as_array()
            .unwrap()
            .iter()
            .map(digest)
            .collect();
        let root = digest(if batch == 3 {
            &f["publicVk"]["commitment"]["cap"][0]
        } else {
            &f["proof"]["commitments"][["random", "trace", "quotient_chunks"][batch]]["cap"][0]
        });
        let cap = MerkleCap::<Val, _>::new(vec![root]);
        let dimensions: Vec<_> = rows[0]
            .iter()
            .map(|r| Dimensions {
                width: r.len(),
                height: 65536,
            })
            .collect();
        mmcs.verify_multi_batch(
            &cap,
            &dimensions,
            &indices,
            &rows,
            &(
                salts.clone(),
                PrunedMerklePaths {
                    sibling_hashes: nodes.clone(),
                },
            ),
        )
        .unwrap();
        let salted: Vec<Vec<Vec<Val>>> = rows
            .iter()
            .zip(&salts)
            .map(|(r, s)| {
                r.iter()
                    .zip(s)
                    .map(|(r, s)| r.iter().chain(s).copied().collect())
                    .collect()
            })
            .collect();
        let dims: Vec<_> = dimensions
            .iter()
            .map(|d| Dimensions {
                width: d.width + 16,
                height: d.height,
            })
            .collect();
        let paths = inner
            .restore_and_recompute_paths(
                &dims,
                &indices,
                &salted,
                &PrunedMerklePaths {
                    sibling_hashes: nodes,
                },
            )
            .unwrap();
        for q in 0..320 {
            mmcs.verify_multi_batch(
                &cap,
                &dimensions,
                &[indices[q]],
                &[rows[q].clone()],
                &(
                    vec![salts[q].clone()],
                    PrunedMerklePaths {
                        sibling_hashes: paths[q].siblings.clone(),
                    },
                ),
            )
            .unwrap();
        }
        batches.push(json!({"batch":batch,"root":dh(&root),"indices":indices,"rows":rows.iter().map(|q|q.iter().map(|r|words(r)).collect::<Vec<_>>()).collect::<Vec<_>>(),"salts":salts.iter().map(|q|q.iter().map(|r|words(r)).collect::<Vec<_>>()).collect::<Vec<_>>(),"paths":paths.iter().map(|p|p.siblings.iter().map(dh).collect::<Vec<_>>()).collect::<Vec<_>>(),"all320NativeSingletonsVerified":true}));
    }
    serde_json::to_writer(
        std::io::stdout().lock(),
        &json!({"publicOnly":true,"sourceDirectory":input,"sourceFixtureSha256":source_fixture_sha256,"sourceProofSha256":source_proof_sha256,"wholeNativeV5ProofVerified":true,"batches":batches}),
    )?;
    eprintln!("4 groups x320 native singleton input proofs verified");
    Ok(())
}
