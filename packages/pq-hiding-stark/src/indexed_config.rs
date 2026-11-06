//! V4 indexed physical commitments; unchanged AIR, field, FRI schedule and vendor code.
//! Quotient and randomizer form one logical product VC with independent physical
//! indexes2/3. Extraction AND-checks/recovers BOTH components before decoding rows.
//! Auxiliary16Fp salt columns are stripped by the original IOP verifier/extractor.
//! This is a fixed-relation knowledge mapping, not a prior-proof SE/custody theorem.
pub use crate::blake_config::{Blake2b512Hash, Challenge, Val};
use crate::indexed_mmcs::IndexedMmcs;
use p3_commit::ExtensionMmcs;
use p3_dft::Radix2DitParallel;
use p3_fri::{FriParameters, HidingFriPcs};
use p3_uni_stark::{PreprocessedProverData, PreprocessedVerifierKey, Proof, StarkConfig};
use rand::{
    SeedableRng,
    rngs::{StdRng, SysRng},
};
pub type ValMmcs = IndexedMmcs;
pub type ChallengeMmcs = ExtensionMmcs<Val, Challenge, ValMmcs>;
pub type Pcs = HidingFriPcs<Val, Radix2DitParallel<Val>, ValMmcs, ChallengeMmcs, StdRng>;
pub type Config = StarkConfig<Pcs, Challenge, crate::full_prefix_v4::Challenger>;
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
pub fn private_pcs() -> Pcs {
    let m = IndexedMmcs::private();
    Pcs::new(
        Radix2DitParallel::default(),
        m.clone(),
        fri_parameters(ExtensionMmcs::new(m)),
        5,
        StdRng::try_from_rng(&mut SysRng).expect("v4 private mask OS entropy unavailable"),
    )
}
pub fn withdrawal_config() -> Config {
    crate::full_prefix_v4::prover_config().0
}
pub fn canonical_membership_preprocessing() -> Result<
    (
        PreprocessedProverData<Config>,
        PreprocessedVerifierKey<Config>,
    ),
    &'static str,
> {
    let m = IndexedMmcs::public_setup();
    let pcs = Pcs::new(
        Radix2DitParallel::default(),
        m.clone(),
        fri_parameters(ExtensionMmcs::new(m)),
        5,
        StdRng::from_seed([0x72; 32]),
    );
    let (bytes, _) = crate::full_prefix_v4::FullPrefixBytes::prover();
    let cfg = Config::new(pcs, crate::full_prefix_v4::Challenger::new(bytes));
    p3_uni_stark::setup_preprocessed(
        &cfg,
        &crate::membership::MembershipAir {
            depth: 32,
            log_rows: 11,
        },
        11,
    )
    .map_err(|_| "v4 fixed public preprocessing failed")?
    .ok_or("v4 preprocessing missing")
}
pub fn check_commitment_roles(
    proof: &Proof<Config>,
    vk: &PreprocessedVerifierKey<Config>,
) -> Result<(), &'static str> {
    if proof.degree_bits != 12
        || vk.degree_bits != 12
        || vk.width != 6
        || vk.commitment.idx != 0
        || vk.commitment.cap.num_roots() != 1
    {
        return Err("v4 fixed public key/profile mismatch");
    }
    let random = proof
        .commitments
        .random
        .as_ref()
        .ok_or("v4 missing randomizer")?;
    if proof.commitments.trace.idx != 1
        || proof.commitments.quotient_chunks.idx != 2
        || random.idx != 3
    {
        return Err("v4 private input index role mismatch");
    }
    let rounds = &proof.opening_proof.1.commit_phase_commits;
    if rounds.len() != 12 {
        return Err("v4 wrong FRI round count");
    }
    for (i, c) in rounds.iter().enumerate() {
        if c.idx != 4 + i as u32 || c.cap.num_roots() != 1 {
            return Err("v4 private FRI index role mismatch");
        }
    }
    for c in [
        &proof.commitments.trace,
        &proof.commitments.quotient_chunks,
        random,
    ] {
        if c.cap.num_roots() != 1 {
            return Err("v4 fixed cap mismatch");
        }
    }
    Ok(())
}
