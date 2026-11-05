//! Experimental native hidden SHA3-512 membership. No withdrawal or PQ-bit claim.
use core::borrow::Borrow;
use p3_air::{Air, AirBuilder, BaseAir, WindowAccess};
use p3_field::{PrimeCharacteristicRing, PrimeField64};
use p3_keccak_air::{KeccakAir, KeccakCols, NUM_KECCAK_COLS, generate_trace_rows};
use p3_matrix::dense::RowMajorMatrix;
use p3_uni_stark::SubAirBuilder;
use sha3::{Digest, Sha3_512};
const AUX: usize = 65;
pub const WIDTH: usize = NUM_KECCAK_COLS + AUX;
#[derive(Debug)]
pub struct MembershipAir {
    pub depth: usize,
    pub log_rows: usize,
}
impl<F: PrimeField64> BaseAir<F> for MembershipAir {
    fn width(&self) -> usize {
        WIDTH
    }
    fn num_public_values(&self) -> usize {
        64
    }
    fn preprocessed_width(&self) -> usize {
        6
    }
    fn preprocessed_trace(&self) -> Option<RowMajorMatrix<F>> {
        assert!((5..=20).contains(&self.log_rows));
        assert!((1..=32).contains(&self.depth));
        assert!((1 << self.log_rows) >= (2 + 2 * self.depth) * 24);
        let mut v = F::zero_vec((1 << self.log_rows) * 6);
        v[23 * 6 + 2] = F::ONE;
        v[23 * 6 + 4] = F::ONE;
        v[47 * 6 + 5] = F::ONE;
        for level in 0..self.depth {
            let start = 48 + 48 * level;
            v[start * 6] = F::ONE;
            v[(start + 23) * 6 + 1] = F::ONE;
            v[(start + 47) * 6 + 2] = F::ONE;
        }
        v[((2 + 2 * self.depth) * 24 - 1) * 6 + 3] = F::ONE;
        Some(RowMajorMatrix::new(v, 6))
    }
}
fn input_bit<AB: AirBuilder>(k: &KeccakCols<AB::Var>, lane: usize, z: usize) -> AB::Expr {
    let y = lane / 5;
    let x = lane % 5;
    let a: AB::Expr = k.a_prime[y][x][z].into();
    a.xor3(&k.c[x][z].into(), &k.c_prime[x][z].into())
}
fn final_bit<AB: AirBuilder>(k: &KeccakCols<AB::Var>, lane: usize, z: usize) -> AB::Expr {
    if lane == 0 {
        let b: AB::Expr = k.a_prime_prime_0_0_bits[z].into();
        return if (0x8000000080008008_u64 >> z) & 1 == 1 {
            AB::Expr::ONE - b
        } else {
            b
        };
    }
    let y = lane / 5;
    let x = lane % 5;
    let a: AB::Expr = k.b(x, y, z).into();
    let b: AB::Expr = k.b((x + 1) % 5, y, z).into();
    let c: AB::Expr = k.b((x + 2) % 5, y, z).into();
    a.xor(&((AB::Expr::ONE - b) * c))
}
impl<AB: AirBuilder> Air<AB> for MembershipAir
where
    AB::F: PrimeField64,
{
    fn eval(&self, b: &mut AB) {
        assert!(
            AB::F::ORDER_U64 >= 1 << 16,
            "Keccak AIR requires characteristic >= 2^16"
        );
        KeccakAir {}.eval(&mut SubAirBuilder::<AB, KeccakAir, AB::Var>::new(
            b,
            0..NUM_KECCAK_COLS,
        ));
        let main = b.main();
        let l = main.current_slice();
        let n = main.next_slice();
        let k: &KeccakCols<AB::Var> = l[..NUM_KECCAK_COLS].borrow();
        let kn: &KeccakCols<AB::Var> = n[..NUM_KECCAK_COLS].borrow();
        let d = l[NUM_KECCAK_COLS + 64];
        b.assert_bool(d);
        let pp = b.preprocessed();
        let flags = pp.current_slice();
        let start = flags[0];
        let first_end = flags[1];
        let update = flags[2];
        let root = flags[3];
        let leaf_end = flags[4];
        let null_end = flags[5];
        let public = b.public_values().to_vec();
        // One permutation: secret64 || SHA3 domain padding; capacity zero.
        for lane in 8..25 {
            let word = if lane == 8 { 0x8000000000000006_u64 } else { 0 };
            for limb in 0..4 {
                b.when_first_row().assert_eq(
                    k.preimage[lane / 5][lane % 5][limb],
                    AB::F::from_u64((word >> (limb * 16)) & 65535),
                );
            }
        }
        // Carry exact current digest, private sibling and direction until each completed hash.
        for i in 0..32 {
            let cur = l[NUM_KECCAK_COLS + i];
            let out = k.a_prime_prime_prime((i / 4) / 5, (i / 4) % 5, i % 4);
            b.when_transition()
                .assert_eq(n[NUM_KECCAK_COLS + i], cur + update * (out - cur));
        }
        for i in 32..65 {
            b.when_transition()
                .when(AB::Expr::ONE - update - null_end)
                .assert_eq(l[NUM_KECCAK_COLS + i], n[NUM_KECCAK_COLS + i]);
        }
        // The nullifier hashes exactly the first32 bytes of the same leaf secret.
        // Its complete SHA3 padding/capacity is fixed; no unchecked nullifier witness.
        for lane in 0..25 {
            for limb in 0..4 {
                if lane < 4 {
                    b.when(leaf_end).assert_eq(
                        kn.preimage[lane / 5][lane % 5][limb],
                        k.preimage[lane / 5][lane % 5][limb],
                    );
                } else {
                    let word = if lane == 4 {
                        6_u64
                    } else if lane == 8 {
                        1_u64 << 63
                    } else {
                        0
                    };
                    b.when(leaf_end).assert_eq(
                        kn.preimage[lane / 5][lane % 5][limb],
                        AB::F::from_u64((word >> (16 * limb)) & 65535),
                    );
                }
            }
        }
        // First rate block is left64 || right[0..8]. Boolean d selects ordering.
        for i in 0..36 {
            let j = if i < 32 { i } else { i - 32 };
            let cur = l[NUM_KECCAK_COLS + j];
            let sib = l[NUM_KECCAK_COLS + 32 + j];
            let expected = if i < 32 {
                cur + d * (sib - cur)
            } else {
                sib + d * (cur - sib)
            };
            b.when(start)
                .assert_eq(k.preimage[(i / 4) / 5][(i / 4) % 5][i % 4], expected);
        }
        for lane in 9..25 {
            for limb in 0..4 {
                b.when(start)
                    .assert_zero(k.preimage[lane / 5][lane % 5][limb]);
            }
        }
        // Absorb remaining right[8..64] and SHA3 padding into ALL lanes of the first output.
        // Bits are derived from already-constrained Keccak columns; no unchecked XOR witness.
        for lane in 0..25 {
            for limb in 0..4 {
                if lane >= 9 {
                    b.when(first_end).assert_eq(
                        kn.preimage[lane / 5][lane % 5][limb],
                        k.a_prime_prime_prime(lane / 5, lane % 5, limb),
                    );
                    continue;
                }
                let xor_limb = (0..16).rev().fold(AB::Expr::ZERO, |acc, bit| {
                    let z = 16 * limb + bit;
                    acc.double() + final_bit::<AB>(k, lane, z).xor(&input_bit::<AB>(kn, lane, z))
                });
                let message = if lane < 7 {
                    let j = (lane + 1) * 4 + limb;
                    let cur = l[NUM_KECCAK_COLS + j];
                    let sib = l[NUM_KECCAK_COLS + 32 + j];
                    sib + d * (cur - sib)
                } else {
                    let word = if lane == 7 { 6_u64 } else { 1_u64 << 63 };
                    AB::Expr::from(AB::F::from_u64((word >> (16 * limb)) & 65535))
                };
                b.when(first_end).assert_eq(xor_limb, message);
            }
        }
        for i in 0..32 {
            let out = k.a_prime_prime_prime((i / 4) / 5, (i / 4) % 5, i % 4);
            b.when(root).assert_eq(out, public[i]);
            b.when(null_end).assert_eq(out, public[32 + i]);
        }
    }
}
pub fn digest(bytes: &[u8]) -> [u8; 64] {
    Sha3_512::digest(bytes).into()
}
fn padded_leaf(secret: [u8; 64]) -> [u64; 25] {
    let mut s = [0; 25];
    for i in 0..8 {
        s[i] = u64::from_le_bytes(secret[i * 8..i * 8 + 8].try_into().unwrap());
    }
    s[8] = 0x8000000000000006;
    s
}
pub fn root_and_nodes(
    secret: [u8; 64],
    siblings: &[[u8; 64]],
    directions: &[bool],
) -> ([u8; 64], Vec<[u8; 64]>, Vec<[u64; 25]>) {
    assert_eq!(siblings.len(), directions.len());
    let mut cur = digest(&secret);
    let mut nodes = vec![cur];
    let mut null_state = [0u64; 25];
    for i in 0..4 {
        null_state[i] = u64::from_le_bytes(secret[8 * i..8 * i + 8].try_into().unwrap());
    }
    null_state[4] = 6;
    null_state[8] = 1 << 63;
    let mut inputs = vec![padded_leaf(secret), null_state];
    for (sib, &d) in siblings.iter().zip(directions) {
        let (left, right) = if d { (sib, &cur) } else { (&cur, sib) };
        let mut msg = [0u8; 128];
        msg[..64].copy_from_slice(left);
        msg[64..].copy_from_slice(right);
        let mut first = [0u64; 25];
        for i in 0..9 {
            first[i] = u64::from_le_bytes(msg[i * 8..i * 8 + 8].try_into().unwrap());
        }
        inputs.push(first);
        tiny_keccak::keccakf(&mut first);
        for i in 0..7 {
            first[i] ^= u64::from_le_bytes(msg[72 + i * 8..80 + i * 8].try_into().unwrap());
        }
        first[7] ^= 6;
        first[8] ^= 1 << 63;
        inputs.push(first);
        cur = digest(&msg);
        nodes.push(cur);
    }
    (cur, nodes, inputs)
}
pub fn public_root<F: PrimeField64>(root: [u8; 64]) -> Vec<F> {
    root.chunks_exact(2)
        .map(|b| F::from_u16(u16::from_le_bytes(b.try_into().unwrap())))
        .collect()
}
pub fn public_values<F: PrimeField64>(root: [u8; 64], secret: [u8; 64]) -> Vec<F> {
    let mut p = public_root(root);
    p.extend(public_root::<F>(digest(&secret[..32])));
    p
}
pub fn trace<F: PrimeField64>(
    secret: [u8; 64],
    siblings: &[[u8; 64]],
    directions: &[bool],
    log_rows: usize,
    extra_capacity_bits: usize,
) -> RowMajorMatrix<F> {
    let (_, nodes, mut inputs) = root_and_nodes(secret, siblings, directions);
    let height = 1 << log_rows;
    assert!(height >= inputs.len() * 24);
    inputs.resize(height / 24, [0; 25]);
    let core = generate_trace_rows::<F>(inputs, extra_capacity_bits);
    assert_eq!(core.values.len(), height * NUM_KECCAK_COLS);
    let mut vals = F::zero_vec(height * WIDTH);
    for row in 0..height {
        let dst = &mut vals[row * WIDTH..(row + 1) * WIDTH];
        dst[..NUM_KECCAK_COLS]
            .copy_from_slice(&core.values[row * NUM_KECCAK_COLS..(row + 1) * NUM_KECCAK_COLS]);
        if row < 24 {
            continue;
        }
        let level = if row < 48 {
            0
        } else {
            ((row - 48) / 48).min(siblings.len())
        };
        for i in 0..32 {
            dst[NUM_KECCAK_COLS + i] = F::from_u16(u16::from_le_bytes(
                nodes[level][2 * i..2 * i + 2].try_into().unwrap(),
            ));
            if row >= 48 && level < siblings.len() {
                dst[NUM_KECCAK_COLS + 32 + i] = F::from_u16(u16::from_le_bytes(
                    siblings[level][2 * i..2 * i + 2].try_into().unwrap(),
                ));
            }
        }
        dst[NUM_KECCAK_COLS + 64] =
            F::from_bool(row >= 48 && level < siblings.len() && directions[level]);
    }
    RowMajorMatrix::new(vals, WIDTH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::borrow::BorrowMut;
    use p3_air::check_constraints;
    use p3_goldilocks::Goldilocks as F;
    fn case() -> (MembershipAir, RowMajorMatrix<F>, Vec<F>) {
        let secret = [7; 64];
        let sib = vec![[19; 64]];
        let dirs = vec![false];
        let root = root_and_nodes(secret, &sib, &dirs).0;
        (
            MembershipAir {
                depth: 1,
                log_rows: 9,
            },
            trace(secret, &sib, &dirs, 9, 0),
            public_values(root, secret),
        )
    }
    fn rejects(a: &MembershipAir, t: &RowMajorMatrix<F>, p: &[F]) {
        assert!(std::panic::catch_unwind(|| check_constraints(a, t, p)).is_err());
    }
    #[test]
    fn depth_one_left_and_right_match_standard() {
        for d in [false, true] {
            let secret = [7; 64];
            let sib = vec![[19; 64]];
            let dirs = vec![d];
            check_constraints(
                &MembershipAir {
                    depth: 1,
                    log_rows: 9,
                },
                &trace::<F>(secret, &sib, &dirs, 9, 0),
                &public_values(root_and_nodes(secret, &sib, &dirs).0, secret),
            );
        }
    }
    #[test]
    fn depth32_all_directions_match_standard() {
        let secret = [7; 64];
        let sib: Vec<_> = (0..32).map(|i| [i as u8; 64]).collect();
        let dirs: Vec<_> = (0..32).map(|i| i % 2 == 1).collect();
        check_constraints(
            &MembershipAir {
                depth: 32,
                log_rows: 11,
            },
            &trace::<F>(secret, &sib, &dirs, 11, 0),
            &public_values(root_and_nodes(secret, &sib, &dirs).0, secret),
        );
    }
    #[test]
    fn changed_root_rejected() {
        let (a, t, mut p) = case();
        p[0] += F::ONE;
        rejects(&a, &t, &p);
    }
    #[test]
    fn non_boolean_direction_rejected() {
        let (a, mut t, p) = case();
        for row in 48..96 {
            t.values[row * WIDTH + NUM_KECCAK_COLS + 64] = F::TWO;
        }
        rejects(&a, &t, &p);
    }
    #[test]
    fn inconsistent_direction_rejected() {
        let (a, mut t, p) = case();
        for row in 72..96 {
            t.values[row * WIDTH + NUM_KECCAK_COLS + 64] = F::ONE;
        }
        rejects(&a, &t, &p);
    }
    #[test]
    fn independently_valid_node_for_wrong_leaf_rejected() {
        let (a, mut t, _) = case();
        let alt = trace::<F>([8; 64], &[[19; 64]], &[false], 9, 0);
        for row in 48..96 {
            t.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS]
                .copy_from_slice(&alt.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS]);
        }
        let p = public_values(root_and_nodes([8; 64], &[[19; 64]], &[false]).0, [7; 64]);
        rejects(&a, &t, &p);
    }
    #[test]
    fn independently_valid_second_block_wrong_absorption_rejected() {
        let (a, mut t, _) = case();
        let mut sib = [19; 64];
        sib[20] ^= 1;
        let alt = trace::<F>([7; 64], &[sib], &[false], 9, 0);
        for row in 72..96 {
            t.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS]
                .copy_from_slice(&alt.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS]);
        }
        let p = public_values(root_and_nodes([7; 64], &[sib], &[false]).0, [7; 64]);
        rejects(&a, &t, &p);
    }
    #[test]
    fn invalid_leaf_padding_rejected() {
        let (a, mut t, p) = case();
        let k: &mut KeccakCols<F> = t.values[..NUM_KECCAK_COLS].borrow_mut();
        k.preimage[1][3][0] = F::ZERO;
        rejects(&a, &t, &p);
    }
    #[test]
    fn changed_nullifier_rejected() {
        let (a, t, mut p) = case();
        p[32] += F::ONE;
        rejects(&a, &t, &p);
    }
    #[test]
    fn independently_valid_nullifier_for_wrong_secret_rejected() {
        let (a, mut t, mut p) = case();
        let alt = trace::<F>([8; 64], &[[19; 64]], &[false], 9, 0);
        for row in 24..48 {
            t.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS]
                .copy_from_slice(&alt.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS]);
        }
        p[32..].copy_from_slice(&public_root::<F>(digest(&[8; 32])));
        rejects(&a, &t, &p);
    }
    #[test]
    fn independently_valid_nullifier_with_wrong_padding_rejected() {
        let (a, mut t, mut p) = case();
        for row in 0..24 {
            let source = t.values[row * WIDTH..row * WIDTH + NUM_KECCAK_COLS].to_vec();
            t.values[(row + 24) * WIDTH..(row + 24) * WIDTH + NUM_KECCAK_COLS]
                .copy_from_slice(&source);
        }
        p[32..].copy_from_slice(&public_root::<F>(digest(&[7; 64])));
        rejects(&a, &t, &p);
    }
    #[test]
    fn noncanonical_root_and_nullifier_limbs_rejected() {
        let (a, t, p) = case();
        for index in [0, 32] {
            let mut wrong = p.clone();
            wrong[index] = F::from_u32(65536);
            rejects(&a, &t, &wrong);
        }
    }
}
