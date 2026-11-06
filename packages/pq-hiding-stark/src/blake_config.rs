//! Isolated API feasibility. No numeric PQ-security claim and no EVM deployment.
use blake2::{Blake2b512, Digest};
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

/// Thin standard BLAKE2b-512 adapter. Both fields and digest words serialize LE-u64.
/// It is RFC 7693 BLAKE2b-512, not a custom hash combiner.
#[derive(Clone, Copy, Debug)]
pub struct Blake2b512Hash;
impl CryptographicHasher<u8, [u8; 64]> for Blake2b512Hash {
    fn hash_iter<I: IntoIterator<Item = u8>>(&self, input: I) -> [u8; 64] {
        let mut h = Blake2b512::new();
        let mut length = 0;
        for b in input {
            h.update([b]);
            length += 1;
        }
        crate::hash_metrics::record(length);
        h.finalize().into()
    }
    fn hash_iter_slices<'a, I: IntoIterator<Item = &'a [u8]>>(&self, input: I) -> [u8; 64] {
        let mut h = Blake2b512::new();
        let mut length = 0;
        for bytes in input {
            h.update(bytes);
            length += bytes.len();
        }
        crate::hash_metrics::record(length);
        h.finalize().into()
    }
}
impl CryptographicHasher<u64, [u64; 8]> for Blake2b512Hash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        let mut h = Blake2b512::new();
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
    let mut h = Blake2b512::new();
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
        tagged_words(b"QRAFT-P3-BLAKE2B-LEAF-v1\0", input)
    }
}
impl CryptographicHasher<u64, [u64; 8]> for NodeHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        tagged_words(b"QRAFT-P3-BLAKE2B-NODE-v1\0", input)
    }
}
pub type FieldHash = SerializingHasher<LeafHash>;
pub type Compress = CompressionFunctionFromHasher<NodeHash, 2, 8>;
pub type ValMmcs = MerkleTreeHidingMmcs<Val, u64, FieldHash, Compress, StdRng, 2, 8, 8>;
pub type ChallengeMmcs = ExtensionMmcs<Val, Challenge, ValMmcs>;
pub type Challenger = SerializingChallenger64<Val, HashChallenger<u8, Blake2b512Hash, 64>>;
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
    make_config(b"QRAFT-BLAKE2B-PREIMAGE-RESEARCH-v1/q320-b16-e5\0")
}

pub fn membership_config() -> Config {
    make_config(b"QRAFT-BLAKE2B-MEMBERSHIP-NULLIFIER-RESEARCH-v1/q320-b16-e5\0")
}

pub fn withdrawal_config() -> Config {
    make_config(b"QRAFT-BLAKE2B-WITHDRAWAL-RESEARCH-v2/q320-b16-e5\0")
}

/// Reproducible commitment to the fixed, PUBLIC preprocessing table only.
/// The deterministic configuration never escapes this function and is never
/// used for private trace commitments, masks, or proving.
pub fn canonical_membership_preprocessing() -> Result<
    (
        p3_uni_stark::PreprocessedProverData<Config>,
        p3_uni_stark::PreprocessedVerifierKey<Config>,
    ),
    &'static str,
> {
    let mmcs = ValMmcs::new(
        FieldHash::new(LeafHash),
        Compress::new(NodeHash),
        0,
        StdRng::from_seed([0x31; 32]),
    );
    let pcs = Pcs::new(
        Radix2DitParallel::default(),
        mmcs.clone(),
        fri_parameters(ExtensionMmcs::new(mmcs)),
        5,
        StdRng::from_seed([0x72; 32]),
    );
    let public_config = Config::new(
        pcs,
        Challenger::new(HashChallenger::new(
            b"QRAFT-BLAKE2B-MEMBERSHIP-NULLIFIER-RESEARCH-v1/q320-b16-e5\0".to_vec(),
            Blake2b512Hash,
        )),
    );
    let air = crate::membership::MembershipAir {
        depth: 32,
        log_rows: 11,
    };
    p3_uni_stark::setup_preprocessed(&public_config, &air, 11)
        .map_err(|_| "Invalid fixed public preprocessing configuration")?
        .ok_or("Missing fixed public preprocessing table")
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
        Challenger::new(HashChallenger::new(domain.to_vec(), Blake2b512Hash)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_public_key_matches_pinned_browser_profile() {
        let (_, vk) = canonical_membership_preprocessing().unwrap();
        let bytes =
            postcard::to_allocvec(&(vk.width as u64, vk.degree_bits as u64, &vk.commitment))
                .unwrap();
        let actual = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(
            actual,
            "060c01e2afedc2e3dca1b939eacbc6f5968aa180b001b68ba1c097a8d88e0285ab81e69ef9e9fac101f0e2a88da2fbe08ca401d1dfa3c4d9e6e4cd8d01fb99c9e7c0f686a9f501b09cdae799fdeaae73"
        );
    }

    #[test]
    fn blake2b_512_standard_empty_and_abc() {
        for (input, expected) in [
            (
                b"".as_slice(),
                "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
            ),
            (
                b"abc".as_slice(),
                "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
            ),
        ] {
            let actual: [u8; 64] = Blake2b512Hash.hash_slice(input);
            assert_eq!(
                actual
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>(),
                expected
            );
            assert_eq!(
                actual,
                <Blake2b512Hash as CryptographicHasher<u8, [u8; 64]>>::hash_iter(
                    &Blake2b512Hash,
                    input.iter().copied()
                )
            );
        }
    }
    #[test]
    fn word_adapter_exact_le_serialization() {
        let words = [0u64, 1, 0xffff_ffff_0000_0000, u64::MAX];
        let actual: [u64; 8] = Blake2b512Hash.hash_slice(&words);
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        let expected: [u8; 64] = Blake2b512Hash.hash_slice(&bytes);
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
            (b"QRAFT-P3-BLAKE2B-LEAF-v1\0".as_slice(), leaf),
            (b"QRAFT-P3-BLAKE2B-NODE-v1\0".as_slice(), node),
        ] {
            let mut bytes = tag.to_vec();
            bytes.extend(words.iter().flat_map(|w| w.to_le_bytes()));
            let expected: [u8; 64] = Blake2b512::digest(bytes).into();
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
