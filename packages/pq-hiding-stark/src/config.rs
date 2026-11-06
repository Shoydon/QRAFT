//! Isolated API feasibility. No numeric PQ-security claim and no EVM deployment.
use p3_challenger::{HashChallenger, SerializingChallenger64};
use p3_commit::ExtensionMmcs;
use p3_dft::Radix2DitParallel;
use p3_field::extension::BinomialExtensionField;
use p3_fri::{FriParameters, HidingFriPcs};
use p3_goldilocks::Goldilocks;
use p3_merkle_tree::MerkleTreeHidingMmcs;
use p3_symmetric::{CompressionFunctionFromHasher, CryptographicHasher, SerializingHasher};
use p3_uni_stark::StarkConfig;
use rand::{SeedableRng, rngs::StdRng};
use sha3::{Digest, Sha3_512};

/// Thin standard SHA3-512 adapter. Both fields and digest words serialize LE-u64.
/// It is SHA3 padding, not EVM's Keccak-256 opcode.
#[derive(Clone, Copy, Debug)]
pub struct Sha3_512Hash;
impl CryptographicHasher<u8, [u8; 64]> for Sha3_512Hash {
    fn hash_iter<I: IntoIterator<Item = u8>>(&self, input: I) -> [u8; 64] {
        let mut h = Sha3_512::new();
        let mut length = 0;
        for b in input {
            h.update([b]);
            length += 1;
        }
        crate::hash_metrics::record(length);
        h.finalize().into()
    }
    fn hash_iter_slices<'a, I: IntoIterator<Item = &'a [u8]>>(&self, input: I) -> [u8; 64] {
        let mut h = Sha3_512::new();
        let mut length = 0;
        for bytes in input {
            h.update(bytes);
            length += bytes.len();
        }
        crate::hash_metrics::record(length);
        h.finalize().into()
    }
}
impl CryptographicHasher<u64, [u64; 8]> for Sha3_512Hash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        let mut h = Sha3_512::new();
        let mut length = 0;
        for w in input {
            h.update(w.to_le_bytes());
            length += 8;
        }
        crate::hash_metrics::record(length);
        let bytes = h.finalize();
        core::array::from_fn(|i| u64::from_le_bytes(bytes[8 * i..8 * i + 8].try_into().unwrap()))
    }
}
pub type Val = Goldilocks;
pub type Challenge = BinomialExtensionField<Val, 5>;
/// Merkle leaves and internal nodes use separate fixed byte domains.
#[derive(Clone, Copy, Debug)]
pub struct LeafHash;
#[derive(Clone, Copy, Debug)]
pub struct NodeHash;
fn tagged_words<I: IntoIterator<Item = u64>>(tag: &[u8], input: I) -> [u64; 8] {
    let mut h = Sha3_512::new();
    h.update(tag);
    let mut length = tag.len();
    for word in input {
        h.update(word.to_le_bytes());
        length += 8;
    }
    crate::hash_metrics::record(length);
    let bytes = h.finalize();
    core::array::from_fn(|i| u64::from_le_bytes(bytes[8 * i..8 * i + 8].try_into().unwrap()))
}
impl CryptographicHasher<u64, [u64; 8]> for LeafHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        tagged_words(b"QRAFT-P3-LEAF-v1\0", input)
    }
}
impl CryptographicHasher<u64, [u64; 8]> for NodeHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        tagged_words(b"QRAFT-P3-NODE-v1\0", input)
    }
}
pub type FieldHash = SerializingHasher<LeafHash>;
pub type Compress = CompressionFunctionFromHasher<NodeHash, 2, 8>;
pub type ValMmcs = MerkleTreeHidingMmcs<Val, u64, FieldHash, Compress, StdRng, 2, 8, 8>;
pub type ChallengeMmcs = ExtensionMmcs<Val, Challenge, ValMmcs>;
pub type Challenger = SerializingChallenger64<Val, HashChallenger<u8, Sha3_512Hash, 64>>;
pub type Pcs = HidingFriPcs<Val, Radix2DitParallel<Val>, ValMmcs, ChallengeMmcs, StdRng>;
pub type Config = StarkConfig<Pcs, Challenge, Challenger>;

pub fn fri_parameters<M>(mmcs: M) -> FriParameters<M> {
    FriParameters {
        log_blowup: 4,
        log_final_poly_len: 0,
        max_log_arity: 1,
        num_queries: 320,
        batch_proof_of_work_bits: 0,
        commit_proof_of_work_bits: 0,
        query_proof_of_work_bits: 0,
        mmcs,
    }
}

/// Conservative feasibility schedule. No end-to-end quantum-security claim:
/// the exact AIR event/knowledge/ZK/QROM ledger remains required.
pub fn config() -> Config {
    make_config(b"QRAFT-SHA3-PREIMAGE-RESEARCH-v1/q320-b16-e5\0")
}

pub fn membership_config() -> Config {
    make_config(b"QRAFT-SHA3-MEMBERSHIP-NULLIFIER-RESEARCH-v1/q320-b16-e5\0")
}

fn make_config(domain: &'static [u8]) -> Config {
    let mmcs = ValMmcs::new(
        FieldHash::new(LeafHash),
        Compress::new(NodeHash),
        0,
        StdRng::from_rng(&mut rand::rng()),
    );
    let fri_mmcs = ChallengeMmcs::new(mmcs.clone());
    let params = fri_parameters(fri_mmcs);
    let pcs = Pcs::new(
        Radix2DitParallel::default(),
        mmcs,
        params,
        5,
        StdRng::from_rng(&mut rand::rng()),
    );
    Config::new(
        pcs,
        Challenger::new(HashChallenger::new(domain.to_vec(), Sha3_512Hash)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sha3_512_nist_empty_and_abc() {
        for (input, expected) in [
            (
                b"".as_slice(),
                "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
            ),
            (
                b"abc".as_slice(),
                "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0",
            ),
        ] {
            let actual: [u8; 64] = Sha3_512Hash.hash_slice(input);
            assert_eq!(
                actual
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>(),
                expected
            );
            assert_eq!(
                actual,
                <Sha3_512Hash as CryptographicHasher<u8, [u8; 64]>>::hash_iter(
                    &Sha3_512Hash,
                    input.iter().copied()
                )
            );
        }
    }
    #[test]
    fn word_adapter_exact_le_serialization() {
        let words = [0u64, 1, 0xffff_ffff_0000_0000, u64::MAX];
        let actual: [u64; 8] = Sha3_512Hash.hash_slice(&words);
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        let expected: [u8; 64] = Sha3_512Hash.hash_slice(&bytes);
        assert_eq!(
            actual
                .iter()
                .flat_map(|w| w.to_le_bytes())
                .collect::<Vec<_>>(),
            expected.to_vec()
        );
    }
    #[test]
    fn merkle_roles_are_separated_and_standard() {
        let words = [0u64; 16];
        let leaf = LeafHash.hash_slice(&words);
        let node = NodeHash.hash_slice(&words);
        assert_ne!(leaf, node);
        for (tag, actual) in [
            (b"QRAFT-P3-LEAF-v1\0".as_slice(), leaf),
            (b"QRAFT-P3-NODE-v1\0".as_slice(), node),
        ] {
            let mut bytes = tag.to_vec();
            bytes.extend(words.iter().flat_map(|w| w.to_le_bytes()));
            let expected: [u8; 64] = Sha3_512::digest(bytes).into();
            assert_eq!(
                actual
                    .iter()
                    .flat_map(|w| w.to_le_bytes())
                    .collect::<Vec<_>>(),
                expected.to_vec()
            );
        }
    }
}
