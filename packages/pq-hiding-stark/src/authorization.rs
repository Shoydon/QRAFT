//! Versioned public withdrawal-context binding around the fixed membership AIR.
//! This defines the relation; pool policy must independently derive the context.
use crate::membership::{self, MembershipAir};
use p3_air::{Air, AirBuilder, BaseAir, WindowAccess};
use p3_field::PrimeField64;
use p3_matrix::dense::RowMajorMatrix;
use p3_uni_stark::SubAirBuilder;

pub const CONTEXT_FIELDS: usize = 32;
pub const PUBLIC_FIELDS: usize = 64 + CONTEXT_FIELDS;
pub const WIDTH: usize = membership::WIDTH + CONTEXT_FIELDS;

#[derive(Debug)]
pub struct WithdrawalAir;
impl<F: PrimeField64> BaseAir<F> for WithdrawalAir {
    fn width(&self) -> usize {
        WIDTH
    }
    fn num_public_values(&self) -> usize {
        PUBLIC_FIELDS
    }
    fn preprocessed_width(&self) -> usize {
        6
    }
    fn preprocessed_trace(&self) -> Option<RowMajorMatrix<F>> {
        <MembershipAir as BaseAir<F>>::preprocessed_trace(&MembershipAir {
            depth: 32,
            log_rows: 11,
        })
    }
}
impl<AB: AirBuilder> Air<AB> for WithdrawalAir
where
    AB::F: PrimeField64,
{
    fn eval(&self, b: &mut AB) {
        MembershipAir {
            depth: 32,
            log_rows: 11,
        }
        .eval(&mut SubAirBuilder::<AB, MembershipAir, AB::Var>::new(
            b,
            0..membership::WIDTH,
        ));
        let main = b.main();
        let local = main.current_slice();
        let next = main.next_slice();
        let public = b.public_values().to_vec();
        for i in 0..CONTEXT_FIELDS {
            b.when_first_row()
                .assert_eq(local[membership::WIDTH + i], public[64 + i]);
            b.when_transition()
                .assert_eq(local[membership::WIDTH + i], next[membership::WIDTH + i]);
        }
    }
}

/// Unambiguous fixed-width packed encoding, shared with the pool contract.
/// Integers are BE; addresses are exactly20 bytes. Domain is NUL-terminated.
pub struct WithdrawalContext {
    pub chain_id: [u8; 32],
    pub pool: [u8; 20],
    pub asset: [u8; 20],
    pub denomination: u128,
    pub recipient: [u8; 20],
    pub relayer: [u8; 20],
    pub fee: u128,
    pub deadline: u64,
}
impl WithdrawalContext {
    pub fn digest(&self) -> [u8; 64] {
        use blake2::{Blake2b512, Digest};
        let mut h = Blake2b512::new();
        h.update(b"QRAFT-WITHDRAW-CONTEXT-v2\0");
        h.update(self.chain_id);
        h.update(self.pool);
        h.update(self.asset);
        h.update(self.denomination.to_be_bytes());
        h.update(self.recipient);
        h.update(self.relayer);
        h.update(self.fee.to_be_bytes());
        h.update(self.deadline.to_be_bytes());
        h.finalize().into()
    }
}
pub fn public_values<F: PrimeField64>(
    root: [u8; 64],
    nullifier: [u8; 64],
    context: [u8; 64],
) -> Vec<F> {
    let mut result = membership::public_root(root);
    result.extend(membership::public_root::<F>(nullifier));
    result.extend(membership::public_root::<F>(context));
    result
}
pub fn trace<F: PrimeField64>(
    secret: [u8; 64],
    siblings: &[[u8; 64]],
    directions: &[bool],
    context: [u8; 64],
    extra_capacity_bits: usize,
) -> RowMajorMatrix<F> {
    assert_eq!(siblings.len(), 32);
    assert_eq!(directions.len(), 32);
    let base = membership::trace::<F>(secret, siblings, directions, 11, extra_capacity_bits);
    let fields = membership::public_root::<F>(context);
    let mut values = F::zero_vec(2048 * WIDTH);
    for row in 0..2048 {
        values[row * WIDTH..row * WIDTH + membership::WIDTH]
            .copy_from_slice(&base.values[row * membership::WIDTH..(row + 1) * membership::WIDTH]);
        values[row * WIDTH + membership::WIDTH..(row + 1) * WIDTH].copy_from_slice(&fields);
    }
    RowMajorMatrix::new(values, WIDTH)
}

#[cfg(test)]
mod tests {
    use p3_field::PrimeCharacteristicRing;
    use super::*;
    use p3_air::check_constraints;
    use p3_goldilocks::Goldilocks as F;
    fn fixture() -> (RowMajorMatrix<F>, Vec<F>) {
        let secret = [7; 64];
        let siblings = vec![[13; 64]; 32];
        let directions = vec![false; 32];
        let context = [19; 64];
        let root = membership::root_and_nodes(secret, &siblings, &directions).0;
        (
            trace(secret, &siblings, &directions, context, 0),
            public_values(root, membership::digest(&secret[..32]), context),
        )
    }
    #[test]
    fn valid_context() {
        let (t, p) = fixture();
        check_constraints(&WithdrawalAir, &t, &p);
    }
    #[test]
    fn changed_context_rejects() {
        let (t, mut p) = fixture();
        p[64] += F::ONE;
        assert!(std::panic::catch_unwind(|| check_constraints(&WithdrawalAir, &t, &p)).is_err());
    }
    #[test]
    fn context_cannot_change_mid_trace() {
        let (mut t, p) = fixture();
        t.values[100 * WIDTH + membership::WIDTH] += F::ONE;
        assert!(std::panic::catch_unwind(|| check_constraints(&WithdrawalAir, &t, &p)).is_err());
    }
    #[test]
    fn public_preprocessing_is_identical() {
        assert_eq!(
            <WithdrawalAir as BaseAir<F>>::preprocessed_trace(&WithdrawalAir)
                .unwrap()
                .values,
            <MembershipAir as BaseAir<F>>::preprocessed_trace(&MembershipAir {
                depth: 32,
                log_rows: 11
            })
            .unwrap()
            .values
        );
    }
    #[test]
    fn every_context_component_changes_digest() {
        let c = || WithdrawalContext {
            chain_id: [0; 32],
            pool: [1; 20],
            asset: [2; 20],
            denomination: 100,
            recipient: [3; 20],
            relayer: [4; 20],
            fee: 1,
            deadline: 123,
        };
        let expected = c().digest();
        for i in 0..8 {
            let mut v = c();
            match i {
                0 => v.chain_id[31] = 1,
                1 => v.pool[0] ^= 1,
                2 => v.asset[0] ^= 1,
                3 => v.denomination += 1,
                4 => v.recipient[0] ^= 1,
                5 => v.relayer[0] ^= 1,
                6 => v.fee += 1,
                _ => v.deadline += 1,
            };
            assert_ne!(v.digest(), expected);
        }
    }
}
