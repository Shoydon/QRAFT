//! Experimental v5 global-domain hiding PCS. No completed compiler/custody claim.
pub use crate::blake_config::{Blake2b512Hash, Challenge, Val};
use blake2::{Blake2b512, Digest};
use p3_commit::ExtensionMmcs;
use p3_dft::Radix2DitParallel;
use p3_fri::{FriParameters, HidingFriPcs};
use p3_merkle_tree::MerkleTreeHidingMmcs;
use p3_symmetric::{CompressionFunctionFromHasher, CryptographicHasher, SerializingHasher};
use p3_uni_stark::{PreprocessedProverData, PreprocessedVerifierKey, StarkConfig};
use rand::{
    SeedableRng,
    rngs::{StdRng, SysRng},
};
#[derive(Clone, Copy, Debug)]
pub struct LeafHash;
#[derive(Clone, Copy, Debug)]
pub struct NodeHash;
pub const LEAF_DOMAIN: &[u8] = b"QRAFT-P3-BLAKE2B-LEAF-v5\0";
pub const NODE_DOMAIN: &[u8] = b"QRAFT-P3-BLAKE2B-NODE-v5\0";
fn tagged<I: IntoIterator<Item = u64>>(tag: &[u8], words: I) -> [u64; 8] {
    let mut h = Blake2b512::new();
    h.update(tag);
    for w in words {
        h.update(w.to_le_bytes());
    }
    let b = h.finalize();
    core::array::from_fn(|i| u64::from_le_bytes(b[8 * i..8 * i + 8].try_into().unwrap()))
}
impl CryptographicHasher<u64, [u64; 8]> for LeafHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, x: I) -> [u64; 8] {
        tagged(LEAF_DOMAIN, x)
    }
}
impl CryptographicHasher<u64, [u64; 8]> for NodeHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, x: I) -> [u64; 8] {
        tagged(NODE_DOMAIN, x)
    }
}
pub type FieldHash = SerializingHasher<LeafHash>;
pub type Compress = CompressionFunctionFromHasher<NodeHash, 2, 8>;
/// Sixteen uniform field salts, support p^16: see docs/pq-finite-field-salt-lemma.md.
pub type ValMmcs = MerkleTreeHidingMmcs<Val, u64, FieldHash, Compress, StdRng, 2, 8, 16>;
pub type ChallengeMmcs = ExtensionMmcs<Val, Challenge, ValMmcs>;
pub type Pcs = HidingFriPcs<Val, Radix2DitParallel<Val>, ValMmcs, ChallengeMmcs, StdRng>;
pub type Config = StarkConfig<Pcs, Challenge, crate::strong_transcript::Challenger>;
fn parameters<M>(mmcs: M) -> FriParameters<M> {
    crate::blake_config::fri_parameters(mmcs)
}
fn build(mmcs: ValMmcs, rng: StdRng) -> Pcs {
    Pcs::new(
        Radix2DitParallel::default(),
        mmcs.clone(),
        parameters(ExtensionMmcs::new(mmcs)),
        5,
        rng,
    )
}
pub fn private_pcs() -> Pcs {
    let mmcs = ValMmcs::new(
        FieldHash::new(LeafHash),
        Compress::new(NodeHash),
        0,
        StdRng::try_from_rng(&mut SysRng).expect("v5 private entropy unavailable"),
    );
    build(
        mmcs,
        StdRng::try_from_rng(&mut SysRng).expect("v5 private entropy unavailable"),
    )
}
/// Fixed public table only; deterministic seeds never enter private proving.
pub fn canonical_preprocessing() -> Result<
    (
        PreprocessedProverData<Config>,
        PreprocessedVerifierKey<Config>,
    ),
    &'static str,
> {
    let mmcs = ValMmcs::new(
        FieldHash::new(LeafHash),
        Compress::new(NodeHash),
        0,
        StdRng::from_seed([0x31; 32]),
    );
    let pcs = build(mmcs, StdRng::from_seed([0x72; 32]));
    let cfg = Config::new(
        pcs,
        crate::strong_transcript::Challenger::new(crate::strong_transcript::StrongBytes::setup()),
    );
    p3_uni_stark::setup_preprocessed(&cfg, &crate::authorization::WithdrawalAir, 11)
        .map_err(|_| "v5 fixed preprocessing failed")?
        .ok_or("v5 preprocessing missing")
}
