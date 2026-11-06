//! V4 index-separated wrapper over unchanged pinned Plonky3 hiding MMCS.
//! Each physical private tree uses its own independent oracle domain.16canonical
//! Fp auxiliary salt fields are128encoded bytes, NOT uniform128binarybytes.
//! Their knowledge mapping is an augmented oracle alphabet with ignored auxiliaries;
//! no everlasting/statistical-ZK or simulation-extractability theorem is asserted.
use crate::blake_config::{Blake2b512Hash, Val};
use p3_challenger::{CanObserve, SerializingChallenger64};
use p3_commit::{BatchOpening, BatchOpeningRef, HidingMmcs, Mmcs, MmcsProofGeometry};
use p3_matrix::{Dimensions, Matrix};
use p3_merkle_tree::{MerkleCap, MerkleTreeError, MerkleTreeHidingMmcs};
use p3_symmetric::{CompressionFunctionFromHasher, CryptographicHasher, Hash, SerializingHasher};
use rand::{
    SeedableRng,
    rngs::{StdRng, SysRng},
};
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

pub const SALT_ELEMENTS: usize = 16;
pub const MAX_PRIVATE_INDEX: u32 = 15;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexedCommitment {
    pub idx: u32,
    pub cap: MerkleCap<Val, [u64; 8]>,
}
#[derive(Clone, Copy, Debug)]
pub struct IndexedLeafHash(pub u32);
#[derive(Clone, Copy, Debug)]
pub struct IndexedNodeHash(pub u32);
fn tagged(tag: &[u8], index: u32, input: impl IntoIterator<Item = u64>) -> [u64; 8] {
    let mut bytes = tag.to_vec();
    bytes.extend_from_slice(&index.to_be_bytes());
    for w in input {
        bytes.extend_from_slice(&w.to_le_bytes());
    }
    let out = Blake2b512Hash.hash_slice(&bytes);
    std::array::from_fn(|i| u64::from_le_bytes(out[8 * i..8 * i + 8].try_into().unwrap()))
}
impl CryptographicHasher<u64, [u64; 8]> for IndexedLeafHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        tagged(b"QRAFT-P3-BLAKE2B-LEAF-v4\0", self.0, input)
    }
}
impl CryptographicHasher<u64, [u64; 8]> for IndexedNodeHash {
    fn hash_iter<I: IntoIterator<Item = u64>>(&self, input: I) -> [u64; 8] {
        tagged(b"QRAFT-P3-BLAKE2B-NODE-v4\0", self.0, input)
    }
}
pub type FieldHash = SerializingHasher<IndexedLeafHash>;
pub type Compress = CompressionFunctionFromHasher<IndexedNodeHash, 2, 8>;
pub type InnerMmcs =
    MerkleTreeHidingMmcs<Val, u64, FieldHash, Compress, StdRng, 2, 8, SALT_ELEMENTS>;
pub struct IndexedProverData<M> {
    pub idx: u32,
    pub data: <InnerMmcs as Mmcs<Val>>::ProverData<M>,
}
#[derive(Clone, Debug)]
pub struct IndexedMmcs {
    next: Arc<AtomicU32>,
    public_setup: bool,
}
#[derive(Debug)]
pub enum IndexedError {
    InvalidIndex,
    Inner(MerkleTreeError),
}
impl IndexedMmcs {
    /// Fresh one-proof allocator, shared by clones across input/FRI MMCS instances.
    pub fn private() -> Self {
        Self {
            next: Arc::new(AtomicU32::new(1)),
            public_setup: false,
        }
    }
    /// Only the canonical public setup path may allocate index0, exactly once.
    pub fn public_setup() -> Self {
        Self {
            next: Arc::new(AtomicU32::new(0)),
            public_setup: true,
        }
    }
    fn allocate(&self) -> u32 {
        self.next
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |idx| {
                if if self.public_setup {
                    idx == 0
                } else {
                    (1..=MAX_PRIVATE_INDEX).contains(&idx)
                } {
                    Some(idx + 1)
                } else {
                    None
                }
            })
            .expect("v4 index allocator exhausted/reused")
    }
    pub fn at(index: u32) -> InnerMmcs {
        assert!(index <= MAX_PRIVATE_INDEX);
        InnerMmcs::new(
            FieldHash::new(IndexedLeafHash(index)),
            Compress::new(IndexedNodeHash(index)),
            0,
            StdRng::from_seed([0; 32]),
        )
    }
    fn for_commit(&self, index: u32) -> InnerMmcs {
        let rng = if self.public_setup {
            StdRng::from_seed([0x31; 32])
        } else {
            StdRng::try_from_rng(&mut SysRng).expect("v4 private salt OS entropy unavailable")
        };
        InnerMmcs::new(
            FieldHash::new(IndexedLeafHash(index)),
            Compress::new(IndexedNodeHash(index)),
            0,
            rng,
        )
    }
}
impl Mmcs<Val> for IndexedMmcs {
    type ProverData<M> = IndexedProverData<M>;
    type Commitment = IndexedCommitment;
    type Proof = <InnerMmcs as Mmcs<Val>>::Proof;
    type MultiProof = <InnerMmcs as Mmcs<Val>>::MultiProof;
    type Error = IndexedError;
    fn proof_geometry(&self, log_height: usize) -> Option<MmcsProofGeometry> {
        Self::at(0).proof_geometry(log_height)
    }
    fn commit<M: Matrix<Val>>(&self, inputs: Vec<M>) -> (Self::Commitment, Self::ProverData<M>) {
        let idx = self.allocate();
        let (cap, data) = self.for_commit(idx).commit(inputs);
        (
            IndexedCommitment { idx, cap },
            IndexedProverData { idx, data },
        )
    }
    fn open_batch<M: Matrix<Val>>(
        &self,
        index: usize,
        data: &Self::ProverData<M>,
    ) -> BatchOpening<Val, Self> {
        let (rows, proof) = Self::at(data.idx).open_batch(index, &data.data).unpack();
        BatchOpening::new(rows, proof)
    }
    fn get_matrices<'a, M: Matrix<Val>>(&self, data: &'a Self::ProverData<M>) -> Vec<&'a M> {
        Self::at(data.idx).get_matrices(&data.data)
    }
    fn verify_batch(
        &self,
        commit: &Self::Commitment,
        dimensions: &[Dimensions],
        index: usize,
        opening: BatchOpeningRef<'_, Val, Self>,
    ) -> Result<(), Self::Error> {
        if commit.idx > MAX_PRIVATE_INDEX {
            return Err(IndexedError::InvalidIndex);
        }
        Self::at(commit.idx)
            .verify_batch(
                &commit.cap,
                dimensions,
                index,
                BatchOpeningRef::new(opening.opened_values, opening.opening_proof),
            )
            .map_err(IndexedError::Inner)
    }
    fn open_multi_batch<M: Matrix<Val>>(
        &self,
        indices: &[usize],
        data: &Self::ProverData<M>,
    ) -> (Vec<Vec<Vec<Val>>>, Self::MultiProof) {
        Self::at(data.idx).open_multi_batch(indices, &data.data)
    }
    fn verify_multi_batch<Row: AsRef<[Val]> + PartialEq>(
        &self,
        commit: &Self::Commitment,
        dimensions: &[Dimensions],
        indices: &[usize],
        opened_values: &[Vec<Row>],
        proof: &Self::MultiProof,
    ) -> Result<(), Self::Error> {
        if commit.idx > MAX_PRIVATE_INDEX {
            return Err(IndexedError::InvalidIndex);
        }
        Self::at(commit.idx)
            .verify_multi_batch(&commit.cap, dimensions, indices, opened_values, proof)
            .map_err(IndexedError::Inner)
    }
}
impl HidingMmcs<Val> for IndexedMmcs {}
/// Index is a fixed4-byte BE prefix, followed by the full64-byte cap, in FS records.
impl<Inner: CanObserve<u8>> CanObserve<IndexedCommitment> for SerializingChallenger64<Val, Inner> {
    fn observe(&mut self, value: IndexedCommitment) {
        self.observe(Hash::<Val, u8, 4>::from(value.idx.to_be_bytes()));
        self.observe(&value.cap);
    }
}
impl<Inner: CanObserve<u8>> CanObserve<&IndexedCommitment> for SerializingChallenger64<Val, Inner> {
    fn observe(&mut self, value: &IndexedCommitment) {
        self.observe(Hash::<Val, u8, 4>::from(value.idx.to_be_bytes()));
        self.observe(&value.cap);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p3_field::PrimeCharacteristicRing;
    use p3_matrix::dense::RowMajorMatrix;
    #[test]
    fn domains_bind_full_index() {
        let words = [1u64, 2, 3];
        assert_ne!(
            IndexedLeafHash(1).hash_slice(&words),
            IndexedLeafHash(2).hash_slice(&words)
        );
        assert_ne!(
            IndexedLeafHash(1).hash_slice(&words),
            IndexedNodeHash(1).hash_slice(&words)
        );
    }
    #[test]
    fn clones_allocate_unique_and_salts_are16_fields() {
        let m = IndexedMmcs::private();
        let c = m.clone();
        let mat = || RowMajorMatrix::new(vec![Val::ONE; 16], 2);
        let (a, ad) = m.commit(vec![mat()]);
        let (b, _) = c.commit(vec![mat()]);
        assert_eq!(a.idx, 1);
        assert_eq!(b.idx, 2);
        let (rows, p) = m.open_multi_batch(&[0, 3, 0], &ad);
        assert_eq!(p.0[0][0].len(), 16);
        m.verify_multi_batch(
            &a,
            &[Dimensions {
                width: 2,
                height: 8,
            }],
            &[0, 3, 0],
            &rows,
            &p,
        )
        .unwrap();
        let mut wrong = a;
        wrong.idx = 2;
        assert!(
            m.verify_multi_batch(
                &wrong,
                &[Dimensions {
                    width: 2,
                    height: 8
                }],
                &[0, 3, 0],
                &rows,
                &p
            )
            .is_err()
        );
    }
    #[test]
    fn independent_private_commits_do_not_reuse_salt_stream() {
        let mat = || RowMajorMatrix::new(vec![Val::ONE; 16], 2);
        let a = IndexedMmcs::private();
        let b = IndexedMmcs::private();
        let (_, ad) = a.commit(vec![mat()]);
        let (_, bd) = b.commit(vec![mat()]);
        assert_ne!(
            a.open_multi_batch(&[0], &ad).1.0,
            b.open_multi_batch(&[0], &bd).1.0
        );
    }
    #[test]
    #[should_panic(expected = "allocator exhausted")]
    fn allocator_exhaustion_fails_closed() {
        let m = IndexedMmcs::public_setup();
        let mat = || RowMajorMatrix::new(vec![Val::ONE; 2], 1);
        m.commit(vec![mat()]);
        m.commit(vec![mat()]);
    }
}
