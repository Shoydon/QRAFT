//! Portable public-only v3 native FRI subset exporter. Never reads or emits a private witness.
use qraft_direct_hiding_research::blake_config::{
    Challenge, Compress, FieldHash, LeafHash, NodeHash, Val, ValMmcs,
};
use p3_commit::Mmcs;
use p3_field::{BasedVectorSpace, Field, PrimeCharacteristicRing, PrimeField64, TwoAdicField};
use p3_fri::{FriFoldingStrategy, TwoAdicFriFoldingForMmcs};
use p3_matrix::Dimensions;
use p3_merkle_tree::{MerkleCap, MerkleTreeMmcs, PrunedMerklePaths};
use rand::{SeedableRng, rngs::StdRng};
use serde_json::Value;
use sha2::Digest;
use std::collections::{BTreeMap, BTreeSet};
use std::marker::PhantomData;
fn num(v: &Value) -> u64 {
    v.as_u64()
        .unwrap_or_else(|| v.as_str().unwrap().parse().unwrap())
}
fn ef(v: &Value) -> Challenge {
    let vs = v.get("value").unwrap_or(v).as_array().unwrap();
    Challenge::from_basis_coefficients_slice(
        &vs.iter().map(|x| Val::new(num(x))).collect::<Vec<_>>(),
    )
    .unwrap()
}
fn dg(v: &Value) -> [u64; 8] {
    std::array::from_fn(|i| num(&v[i]))
}
fn hex(b: impl IntoIterator<Item = u8>) -> String {
    b.into_iter().map(|v| format!("{v:02x}")).collect()
}
fn words(row: &[Val]) -> String {
    hex(row.iter().flat_map(|v| v.as_canonical_u64().to_le_bytes()))
}
fn ext(a: Challenge) -> Vec<u64> {
    a.as_basis_coefficients_slice()
        .iter()
        .map(|v: &Val| v.as_canonical_u64())
        .collect()
}
fn digest(d: &[u64; 8]) -> String {
    hex(d.iter().flat_map(|v| v.to_le_bytes()))
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
    use qraft_direct_hiding_research::full_prefix as fp;
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
    let supplied_salts: Vec<[u64; 8]> = fixture["publicSalts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| std::array::from_fn(|i| num(&s[i])))
        .collect();
    assert_eq!(supplied_salts, envelope.salts);
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
    let mut blocks = [0u32; 16];
    for call in &report.calls {
        assert_eq!(call.block, blocks[call.round as usize]);
        blocks[call.round as usize] += 1;
        streams[call.round as usize].extend(call.output.iter().rev().copied());
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
    let directory = std::env::args()
        .nth(1)
        .unwrap_or("packages/pq-hiding-stark/benchmark-results/evm-v3".into());
    let challenge_path = std::env::args()
        .nth(2)
        .unwrap_or(format!("{directory}/challenges.json"));
    let fixture_bytes = std::fs::read(format!("{directory}/fixture.json"))?;
    let source_fixture_sha256 = format!("{:x}", sha2::Sha256::digest(&fixture_bytes));
    let fixture: Value = serde_json::from_slice(&fixture_bytes)?;
    let challenges: Value = serde_json::from_slice(&std::fs::read(challenge_path)?)?;
    let source_proof_sha256 =
        verify_source(std::path::Path::new(&directory), &fixture, &challenges)?;
    let fri = &fixture["proof"]["opening_proof"][1];
    let folding: TwoAdicFriFoldingForMmcs<Val, ValMmcs> = p3_fri::TwoAdicFriFolding(PhantomData);
    let original_indices: Vec<usize> = challenges["indices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| num(x) as usize)
        .collect();
    assert_eq!(original_indices.len(), 320);
    let final_constant = ef(&fri["final_poly"][0]);
    let mut expected = vec![final_constant; 320];
    let mut rounds = vec![];
    for round in (0..12).rev() {
        let logh = 15 - round;
        let beta = ef(&challenges["betas"][round]);
        let indices: Vec<_> = original_indices.iter().map(|i| i >> round).collect();
        let groups: Vec<usize> = indices.iter().map(|i| i >> 1).collect();
        let opening = &fri["commit_phase_openings"][round];
        let siblings: Vec<_> = opening["sibling_values"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| ef(&v[0]))
            .collect();
        let mut carried = vec![];
        let mut rows = vec![];
        for q in 0..320 {
            let exponent = (groups[q] as u64).reverse_bits() >> (64 - logh);
            let s = Val::two_adic_generator(logh + 1).exp_u64(exponent);
            let z = beta * s.inverse();
            let c0 = (Challenge::ONE + z).halve();
            let c1 = (Challenge::ONE - z).halve();
            let value = if indices[q] & 1 == 0 {
                (expected[q] - c1 * siblings[q]) * c0.inverse()
            } else {
                (expected[q] - c0 * siblings[q]) * c1.inverse()
            };
            let row = if indices[q] & 1 == 0 {
                [value, siblings[q]]
            } else {
                [siblings[q], value]
            };
            let actual = <TwoAdicFriFoldingForMmcs<Val, ValMmcs> as FriFoldingStrategy<
                Val,
                Challenge,
            >>::fold_row(
                &folding, groups[q], logh, 1, beta, row.into_iter()
            );
            assert_eq!(actual, expected[q]);
            rows.push(vec![
                row.iter()
                    .flat_map(|v| {
                        v.as_basis_coefficients_slice()
                            .iter()
                            .copied()
                            .collect::<Vec<Val>>()
                    })
                    .collect::<Vec<_>>(),
            ]);
            carried.push(value);
        }
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
                            .map(|x| Val::new(num(x)))
                            .collect()
                    })
                    .collect()
            })
            .collect();
        let nodes: Vec<[u64; 8]> = opening["opening_proof"][1]["sibling_hashes"]
            .as_array()
            .unwrap()
            .iter()
            .map(dg)
            .collect();
        let root = dg(&fri["commit_phase_commits"][round]["cap"][0]);
        let cap = MerkleCap::<Val, _>::new(vec![root]);
        let mmcs = ValMmcs::new(
            FieldHash::new(LeafHash),
            Compress::new(NodeHash),
            0,
            StdRng::from_seed([0; 32]),
        );
        let proof = (
            salts.clone(),
            PrunedMerklePaths {
                sibling_hashes: nodes.clone(),
            },
        );
        mmcs.verify_multi_batch(
            &cap,
            &[Dimensions {
                width: 10,
                height: 1 << logh,
            }],
            &groups,
            &rows,
            &proof,
        )
        .unwrap();
        let inner = MerkleTreeMmcs::<Val, u64, _, _, 2, 8>::new(
            FieldHash::new(LeafHash),
            Compress::new(NodeHash),
            0,
        );
        let salted_rows: Vec<Vec<Vec<Val>>> = rows
            .iter()
            .zip(&salts)
            .map(|(r, s)| vec![r[0].iter().chain(&s[0]).copied().collect()])
            .collect();
        let paths = inner
            .restore_and_recompute_paths(
                &[Dimensions {
                    width: 18,
                    height: 1 << logh,
                }],
                &groups,
                &salted_rows,
                &proof.1,
            )
            .unwrap();
        // A full binary path is also a valid singleton pruned multiproof.
        for q in 0..320 {
            mmcs.verify_multi_batch(
                &cap,
                &[Dimensions {
                    width: 10,
                    height: 1 << logh,
                }],
                &[groups[q]],
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
        let mut subsets = vec![];
        for start in (0..320).step_by(32) {
            let end = (start + 32).min(320);
            let mut boundary = BTreeMap::new();
            for q in start..end {
                let mut position = groups[q];
                for (level, node) in paths[q].siblings.iter().enumerate() {
                    if let Some(previous) = boundary.insert((level, position ^ 1), *node) {
                        assert_eq!(previous, *node);
                    }
                    position >>= 1;
                }
            }
            let mut frontier: Vec<usize> = groups[start..end]
                .iter()
                .copied()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let mut subset_nodes = vec![];
            for level in 0..logh {
                let mut parents = vec![];
                let mut at = 0;
                while at < frontier.len() {
                    let parent = frontier[at] >> 1;
                    for child in [parent * 2, parent * 2 + 1] {
                        if at < frontier.len() && frontier[at] == child {
                            at += 1;
                        } else {
                            subset_nodes.push(
                                *boundary
                                    .get(&(level, child))
                                    .expect("restored path supplies boundary"),
                            );
                        }
                    }
                    parents.push(parent);
                }
                frontier = parents;
            }
            assert_eq!(frontier, vec![0]);
            let subset_proof = (
                salts[start..end].to_vec(),
                PrunedMerklePaths {
                    sibling_hashes: subset_nodes.clone(),
                },
            );
            mmcs.verify_multi_batch(
                &cap,
                &[Dimensions {
                    width: 10,
                    height: 1 << logh,
                }],
                &groups[start..end],
                &rows[start..end],
                &subset_proof,
            )
            .unwrap();
            subsets.push(serde_json::json!({"start":start,"count":end-start,"indices":&indices[start..end],"next_indices":&groups[start..end],"carried":carried[start..end].iter().copied().map(ext).collect::<Vec<_>>(),"sibling_values":siblings[start..end].iter().copied().map(ext).collect::<Vec<_>>(),"expected":expected[start..end].iter().copied().map(ext).collect::<Vec<_>>(),"salts":salts[start..end].iter().map(|q|q.iter().map(|m|words(m)).collect::<Vec<_>>()).collect::<Vec<_>>(),"siblings":subset_nodes.iter().map(digest).collect::<Vec<_>>(),"nativeSubsetVerified":true}));
        }
        let salt_hex: Vec<Vec<String>> = salts
            .iter()
            .map(|q| q.iter().map(|m| words(m)).collect())
            .collect();
        rounds.push(serde_json::json!({"subsets":subsets,"round":round,"beta":ext(beta),"indices":indices,"next_indices":groups,"carried":carried.iter().copied().map(ext).collect::<Vec<_>>(),"sibling_values":siblings.iter().copied().map(ext).collect::<Vec<_>>(),"expected":expected.iter().copied().map(ext).collect::<Vec<_>>(),"root":digest(&root),"salts":salt_hex,"siblings":nodes.iter().map(digest).collect::<Vec<_>>(),"singleton_siblings":paths[0].siblings.iter().map(digest).collect::<Vec<_>>(),"singleton_paths":paths.iter().map(|p|p.siblings.iter().map(digest).collect::<Vec<_>>()).collect::<Vec<_>>(),"allSingletonPathsNativeVerified":true,"native_verified":true}));
        eprintln!("actualproof round{round} all320 native root/auth/foldsverified");
        expected = carried;
    }
    rounds.reverse();
    println!("{}",serde_json::to_string_pretty(&serde_json::json!({"rounds":rounds,"final_constant":ext(final_constant),"kind":"actual proof, native-verified backwards recovered carried values; public proof data only","source_directory":directory,"sourceFixtureSha256":source_fixture_sha256,"sourceProofSha256":source_proof_sha256,"wholeNativeV3ProofVerified":true,"subsetSize":32,"all120SubsetsNativeVerified":true})).unwrap());
    Ok(())
}
