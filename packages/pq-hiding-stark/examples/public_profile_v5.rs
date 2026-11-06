//! Export the deterministic public preprocessing key. No witness, proof or RPC input.
use qraft_direct_hiding_research::strong_config;

fn main() {
    let (_, key) = strong_config::canonical_preprocessing().expect("canonical public key");
    let root = key
        .commitment
        .roots()
        .iter()
        .flat_map(|digest| digest.iter().flat_map(|word| word.to_le_bytes()))
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(root.len(), 128);
    println!("{}", serde_json::json!({
        "profile": "qraft-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16",
        "width": key.width,
        "degreeBits": key.degree_bits,
        "preprocessingRoot": root,
        "privateWitnessRead": false
    }));
}
