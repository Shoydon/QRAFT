//! Experimental relation work. No production or quantum-security claim.
pub mod authorization;
pub mod strong_config;
pub mod strong_transcript;
pub mod blake_config;
pub mod full_prefix;
pub mod indexed_mmcs;
pub mod indexed_config;
pub mod full_prefix_v4;
pub mod config;
pub mod hash_metrics;
pub mod membership;
use core::borrow::Borrow;
use p3_air::{Air, AirBuilder, BaseAir, WindowAccess};
use p3_field::{PrimeCharacteristicRing, PrimeField64};
use p3_keccak_air::{KeccakAir, KeccakCols, NUM_KECCAK_COLS, generate_trace_rows};
use p3_matrix::dense::RowMajorMatrix;

/// Knowledge of a 32-byte secret with the supplied SHA3-512 digest.
/// Only permutation zero is part of this relation; other rows are padding.
/// This is a component experiment, not a withdrawal or membership proof.
#[derive(Debug)]
pub struct Sha3PreimageAir {
    pub log_rows: usize,
}

impl<F: PrimeField64> BaseAir<F> for Sha3PreimageAir {
    fn width(&self) -> usize {
        NUM_KECCAK_COLS
    }
    fn num_public_values(&self) -> usize {
        32
    }
    fn preprocessed_width(&self) -> usize {
        1
    }
    fn preprocessed_trace(&self) -> Option<RowMajorMatrix<F>> {
        assert!((5..=20).contains(&self.log_rows));
        let mut flags = F::zero_vec(1 << self.log_rows);
        flags[23] = F::ONE;
        Some(RowMajorMatrix::new(flags, 1))
    }
}

impl<AB: AirBuilder> Air<AB> for Sha3PreimageAir
where
    AB::F: PrimeField64,
{
    fn eval(&self, builder: &mut AB) {
        assert!(
            AB::F::ORDER_U64 >= 1 << 16,
            "Keccak AIR requires characteristic >= 2^16"
        );
        KeccakAir {}.eval(builder);
        let main = builder.main();
        let local: &KeccakCols<AB::Var> = main.current_slice().borrow();
        // SHA3-512 rate = 72 bytes. A 32-byte input needs one permutation:
        // input || 0x06 || zeros || 0x80, with zero capacity lanes.
        for lane in 4..25 {
            let word = match lane {
                4 => 0x06_u64,
                8 => 1_u64 << 63,
                _ => 0,
            };
            for limb in 0..4 {
                let expected = AB::F::from_u64((word >> (16 * limb)) & 0xffff);
                builder
                    .when_first_row()
                    .assert_eq(local.preimage[lane / 5][lane % 5][limb], expected);
            }
        }
        let final_selector = builder.preprocessed().current_slice()[0];
        let public = builder.public_values().to_vec();
        for lane in 0..8 {
            for limb in 0..4 {
                builder.when(final_selector).assert_eq(
                    local.a_prime_prime_prime(lane / 5, lane % 5, limb),
                    public[lane * 4 + limb],
                );
            }
        }
    }
}

pub fn trace<F: PrimeField64>(
    secret: [u8; 32],
    log_rows: usize,
    extra_capacity_bits: usize,
) -> RowMajorMatrix<F> {
    assert!((5..=20).contains(&log_rows));
    let mut state = [0_u64; 25];
    for (lane, chunk) in secret.chunks_exact(8).enumerate() {
        state[lane] = u64::from_le_bytes(chunk.try_into().unwrap());
    }
    state[4] = 0x06;
    state[8] = 1 << 63;
    // Enough real permutations to select exactly the fixed power-of-two height.
    let count = ((1 << log_rows) / 24).max(1);
    let mut inputs = vec![[0_u64; 25]; count];
    inputs[0] = state;
    let trace = generate_trace_rows(inputs, extra_capacity_bits);
    assert_eq!(trace.values.len(), (1 << log_rows) * NUM_KECCAK_COLS);
    trace
}

pub fn public_digest<F: PrimeField64>(secret: [u8; 32]) -> Vec<F> {
    use sha3::{Digest, Sha3_512};
    Sha3_512::digest(secret)
        .chunks_exact(2)
        .map(|bytes| F::from_u16(u16::from_le_bytes(bytes.try_into().unwrap())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use p3_air::check_constraints;
    use p3_goldilocks::Goldilocks;

    #[test]
    fn matches_independent_standard_sha3_512() {
        for secret in [[0; 32], [0xff; 32], core::array::from_fn(|i| i as u8)] {
            check_constraints(
                &Sha3PreimageAir { log_rows: 5 },
                &trace::<Goldilocks>(secret, 5, 0),
                &public_digest(secret),
            );
        }
    }

    #[test]
    #[should_panic]
    fn changed_digest_rejects() {
        let mut public = public_digest::<Goldilocks>([7; 32]);
        public[0] += Goldilocks::ONE;
        check_constraints(
            &Sha3PreimageAir { log_rows: 5 },
            &trace::<Goldilocks>([7; 32], 5, 0),
            &public,
        );
    }

    #[test]
    #[should_panic]
    fn changed_padding_rejects() {
        let mut witness = trace::<Goldilocks>([7; 32], 5, 0);
        let first: &mut KeccakCols<Goldilocks> =
            core::borrow::BorrowMut::borrow_mut(&mut witness.values[..NUM_KECCAK_COLS]);
        first.preimage[0][4][0] = Goldilocks::ZERO;
        check_constraints(
            &Sha3PreimageAir { log_rows: 5 },
            &witness,
            &public_digest([7; 32]),
        );
    }

    #[test]
    #[should_panic]
    fn different_secret_rejects() {
        check_constraints(
            &Sha3PreimageAir { log_rows: 5 },
            &trace::<Goldilocks>([8; 32], 5, 0),
            &public_digest([7; 32]),
        );
    }

    #[test]
    #[should_panic]
    fn high_output_limb_rejects() {
        let mut public = public_digest::<Goldilocks>([7; 32]);
        public[31] += Goldilocks::from_u64(1 << 16);
        check_constraints(
            &Sha3PreimageAir { log_rows: 5 },
            &trace::<Goldilocks>([7; 32], 5, 0),
            &public,
        );
    }
}
