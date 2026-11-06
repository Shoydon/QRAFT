//! Version3 full-prefix, public-round-salted Fiat--Shamir byte adapter.
//!
//! Fixed Construction11.7 correspondence is recorded in docs/pq-security-claim.md.
//! One logical verifier move uses ONE salt across all coordinates, rejections and
//! refill blocks. Neither challenge bytes nor checkpoint digests enter the prefix.
//! Raw adapter limits panic (the byte traits cannot return errors); the native
//! envelope verifier catches exhaustion and fails closed. Use fresh configs per proof.
use crate::blake_config as bc;
use p3_challenger::{ByteGrindingChallenger, CanObserve, CanSample, SerializingChallenger64};
use p3_symmetric::CryptographicHasher;
use p3_uni_stark::{
    PreprocessedProverData, PreprocessedVerifierKey, Proof, StarkConfig, StarkGenericConfig,
    verify_with_preprocessed,
};
use rand::{TryRng, rngs::SysRng};
use std::sync::{Arc, Mutex};

pub const DOMAIN: &[u8] = b"QRAFT-FS-FULL-PREFIX-v3\0";
pub const PROFILE: &[u8] = b"QRAFT-WITHDRAWAL-V3/q320-b16-e5\0";
pub const MOVES: usize = 16;
pub const BLOCKS_PER_MOVE: usize = 64;
pub const MAX_HISTORY_BYTES: usize = 1 << 20;
pub const MAX_ENVELOPE_BYTES: usize = 16 << 20;
pub type Salt = [u64; 8];
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OracleCall {
    pub round: u32,
    pub block: u32,
    pub input: Vec<u8>,
    pub output: [u8; 64],
}
#[derive(Clone, Debug, Default)]
pub struct TranscriptReport {
    pub salts: Vec<Salt>,
    pub calls: Vec<OracleCall>,
}
pub type Report = Arc<Mutex<TranscriptReport>>;
#[derive(Clone, Debug)]
enum SaltSource {
    FreshOs,
    Provided(Arc<Vec<Salt>>),
}
#[derive(Clone, Debug)]
pub struct FullPrefixBytes {
    records: Vec<Vec<u8>>,
    pending: Vec<u8>,
    history_bytes: usize,
    salts: Vec<Salt>,
    buffer: Vec<u8>,
    next_block: usize,
    source: SaltSource,
    report: Report,
}
impl FullPrefixBytes {
    pub fn prover() -> (Self, Report) {
        Self::new(SaltSource::FreshOs)
    }
    pub fn verifier(salts: Vec<Salt>) -> Result<(Self, Report), &'static str> {
        if salts.len() != MOVES {
            return Err("v3 requires exactly16 public round salts");
        }
        Ok(Self::new(SaltSource::Provided(Arc::new(salts))))
    }
    fn new(source: SaltSource) -> (Self, Report) {
        let report = Arc::new(Mutex::new(TranscriptReport::default()));
        (
            Self {
                records: vec![],
                pending: PROFILE.to_vec(),
                history_bytes: 0,
                salts: vec![],
                buffer: vec![],
                next_block: 0,
                source,
                report: report.clone(),
            },
            report,
        )
    }
    fn begin_move(&mut self) {
        assert!(
            !self.pending.is_empty(),
            "v3 missing observed prover message"
        );
        let round = self.records.len();
        assert!(round < MOVES, "v3 round bound exhausted");
        let salt = match &self.source {
            SaltSource::FreshOs => {
                let mut bytes = [0u8; 64];
                SysRng
                    .try_fill_bytes(&mut bytes)
                    .expect("v3 OS public salt entropy unavailable");
                std::array::from_fn(|i| {
                    u64::from_le_bytes(bytes[8 * i..8 * i + 8].try_into().unwrap())
                })
            }
            SaltSource::Provided(salts) => salts[round],
        };
        self.history_bytes += self.pending.len();
        assert!(
            self.history_bytes <= MAX_HISTORY_BYTES,
            "v3 history bound exhausted"
        );
        self.records.push(std::mem::take(&mut self.pending));
        self.salts.push(salt);
        self.buffer.clear();
        self.next_block = 0;
        let mut report = self.report.lock().unwrap();
        assert_eq!(
            report.salts.len(),
            round,
            "v3 config/report cannot be reused across executions"
        );
        report.salts.push(salt);
    }
    fn refill(&mut self) {
        assert!(!self.records.is_empty(), "v3 missing first move");
        assert!(
            self.next_block < BLOCKS_PER_MOVE,
            "v3 block bound exhausted"
        );
        let round = (self.records.len() - 1) as u32;
        let block = self.next_block as u32;
        let mut input = Vec::with_capacity(
            DOMAIN.len() + 16 + self.history_bytes + self.records.len() * 8 + self.salts.len() * 64,
        );
        input.extend_from_slice(DOMAIN);
        input.extend_from_slice(&round.to_be_bytes());
        input.extend_from_slice(&block.to_be_bytes());
        input.extend_from_slice(&(self.records.len() as u32).to_be_bytes());
        for record in &self.records {
            input.extend_from_slice(&(record.len() as u64).to_be_bytes());
            input.extend_from_slice(record);
        }
        input.extend_from_slice(&(self.salts.len() as u32).to_be_bytes());
        for salt in &self.salts {
            for word in salt {
                input.extend_from_slice(&word.to_le_bytes());
            }
        }
        let output = bc::Blake2b512Hash.hash_slice(&input);
        self.report.lock().unwrap().calls.push(OracleCall {
            round,
            block,
            input,
            output,
        });
        self.buffer = output.to_vec();
        self.next_block += 1;
    }
}
impl CanObserve<u8> for FullPrefixBytes {
    fn observe(&mut self, value: u8) {
        assert!(
            self.history_bytes + self.pending.len() < MAX_HISTORY_BYTES,
            "v3 history bound exhausted"
        );
        self.pending.push(value);
        self.buffer.clear();
    }
    fn observe_slice(&mut self, values: &[u8]) {
        if values.is_empty() {
            return;
        }
        assert!(
            values.len() <= MAX_HISTORY_BYTES - self.history_bytes - self.pending.len(),
            "v3 history bound exhausted"
        );
        self.pending.extend_from_slice(values);
        self.buffer.clear();
    }
}
impl CanSample<u8> for FullPrefixBytes {
    fn sample(&mut self) -> u8 {
        if !self.pending.is_empty() {
            self.begin_move();
        }
        if self.buffer.is_empty() {
            self.refill();
        }
        self.buffer.pop().expect("64byte oracle block")
    }
}
impl ByteGrindingChallenger for FullPrefixBytes {}
pub type Challenger = SerializingChallenger64<bc::Val, FullPrefixBytes>;
pub type Config = StarkConfig<bc::Pcs, bc::Challenge, Challenger>;
/// Public proof envelope. Export codecs must encode the16 salts with the proof.
/// Salts are512-bit byte strings (not field values), with LE-u64 wire coordinates.
pub struct Envelope {
    pub salts: Vec<Salt>,
    pub proof: Proof<Config>,
}
impl Envelope {
    /// Canonical postcard sequence: exactly16 public salts, then the native proof.
    pub fn to_bytes(&self) -> Result<Vec<u8>, postcard::Error> {
        if self.salts.len() != MOVES {
            return Err(postcard::Error::SerializeBufferFull);
        }
        let encoded = postcard::to_allocvec(&(&self.salts, &self.proof))?;
        if encoded.len() > MAX_ENVELOPE_BYTES {
            return Err(postcard::Error::SerializeBufferFull);
        }
        Ok(encoded)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, postcard::Error> {
        // The canonical Vec length16 is one byte. Gate it and total length before allocation.
        if bytes.len() > MAX_ENVELOPE_BYTES || bytes.first() != Some(&(MOVES as u8)) {
            return Err(postcard::Error::DeserializeBadEncoding);
        }
        let ((salts, proof), remaining): ((Vec<Salt>, Proof<Config>), &[u8]) =
            postcard::take_from_bytes(bytes)?;
        if !remaining.is_empty() || salts.len() != MOVES {
            return Err(postcard::Error::DeserializeBadEncoding);
        }
        let result = Self { salts, proof };
        // Reject alternate/nonminimal varints rather than merely normalizing them.
        if result.to_bytes()?.as_slice() != bytes {
            return Err(postcard::Error::DeserializeBadEncoding);
        }
        Ok(result)
    }
}

pub fn prover_config() -> (Config, Report) {
    // Fresh private PCS RNGs are independent of the direct OS public salt draws.
    let private = bc::withdrawal_config();
    let (bytes, report) = FullPrefixBytes::prover();
    (
        Config::new(private.pcs().clone(), Challenger::new(bytes)),
        report,
    )
}
pub fn verifier_config(pcs: bc::Pcs, salts: Vec<Salt>) -> Result<(Config, Report), &'static str> {
    let (bytes, report) = FullPrefixBytes::verifier(salts)?;
    Ok((Config::new(pcs, Challenger::new(bytes)), report))
}
pub fn canonical_preprocessing() -> Result<
    (
        PreprocessedProverData<Config>,
        PreprocessedVerifierKey<Config>,
    ),
    &'static str,
> {
    let (pd, vk) = bc::canonical_membership_preprocessing()?;
    Ok((
        PreprocessedProverData {
            width: pd.width,
            degree_bits: pd.degree_bits,
            commitment: pd.commitment,
            prover_data: pd.prover_data,
        },
        PreprocessedVerifierKey {
            width: vk.width,
            degree_bits: vk.degree_bits,
            commitment: vk.commitment,
        },
    ))
}
pub fn assert_complete(report: &Report) -> Result<(), &'static str> {
    let report = report.lock().map_err(|_| "v3 transcript failed")?;
    if report.salts.len() != MOVES {
        return Err("v3 did not consume all16 public salts");
    }
    if report.calls.is_empty() || report.calls.last().unwrap().round != 15 {
        return Err("v3 missing final joint query move");
    }
    Ok(())
}
/// Canonical high-level verifier: never accepts a prover-selected PCS, VK or profile.
pub fn verify_envelope(
    envelope: &Envelope,
    expected_public: &[bc::Val],
) -> Result<TranscriptReport, &'static str> {
    let (_, vk) = canonical_preprocessing()?;
    let canonical = bc::withdrawal_config();
    verify_with_fixed_parameters(canonical.pcs().clone(), envelope, expected_public, &vk)
}
/// Native boundary: catch trait-limit panics and reject rather than accepting a
/// truncated challenge stream. The PCS and VK are the fixed public profile inputs.
fn verify_with_fixed_parameters(
    pcs: bc::Pcs,
    envelope: &Envelope,
    public: &[bc::Val],
    vk: &PreprocessedVerifierKey<Config>,
) -> Result<TranscriptReport, &'static str> {
    let (cfg, report) = verifier_config(pcs, envelope.salts.clone())?;
    let verified = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        verify_with_preprocessed(
            &cfg,
            &crate::authorization::WithdrawalAir,
            &envelope.proof,
            public,
            Some(vk),
        )
    }));
    match verified {
        Ok(Ok(())) => {}
        _ => return Err("v3 proof/transcript rejected"),
    }
    assert_complete(&report)?;
    let result = report.lock().map_err(|_| "v3 transcript failed")?.clone();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use p3_challenger::{CanObserve, CanSample, CanSampleBits};
    fn salts() -> Vec<Salt> {
        (0..MOVES).map(|i| [i as u64; 8]).collect()
    }
    #[test]
    fn exactly16_salts_required() {
        assert!(FullPrefixBytes::verifier(vec![]).is_err());
        assert!(FullPrefixBytes::verifier(vec![[0; 8]; 17]).is_err());
    }
    #[test]
    fn refills_and_joint_queries_share_one_salt() {
        let (b, report) = FullPrefixBytes::verifier(salts()).unwrap();
        let mut c = Challenger::new(b);
        for _ in 0..320 {
            let _: usize = c.sample_bits(16);
        }
        let r = report.lock().unwrap();
        assert_eq!(r.salts.len(), 1);
        assert_eq!(r.calls.len(), 40);
        for (i, call) in r.calls.iter().enumerate() {
            assert_eq!(call.round, 0);
            assert_eq!(call.block, i as u32);
            assert!(call.input.ends_with(&[0; 64]));
        }
    }
    #[test]
    fn canonical_rejection_and_extension_coordinates_share_move() {
        let (b, report) = FullPrefixBytes::verifier(salts()).unwrap();
        let mut c = Challenger::new(b);
        for _ in 0..20 {
            let _: bc::Challenge = c.sample();
        }
        let r = report.lock().unwrap();
        assert_eq!(r.salts.len(), 1);
        assert_eq!(r.calls.len(), 13);
    }
    #[test]
    fn forced_field_rejection_reuses_same_salt() {
        let (mut bytes, report) = FullPrefixBytes::verifier(salts()).unwrap();
        bytes.begin_move();
        // Inject a test-only oracle buffer: first sampled u64 is MAX (rejected), next is0.
        bytes.buffer = vec![0; 8];
        bytes.buffer.extend([255; 8]);
        let mut c = Challenger::new(bytes);
        let result: bc::Val = c.sample();
        use p3_field::PrimeField64;
        assert_eq!(result.as_canonical_u64(), 0);
        let _: bc::Challenge = c.sample();
        let r = report.lock().unwrap();
        assert_eq!(r.salts.len(), 1);
        assert_eq!(r.calls.len(), 1);
        assert_eq!(r.calls[0].round, 0);
        assert_eq!(r.calls[0].block, 0);
    }
    #[test]
    fn empty_observe_does_not_start_move() {
        let (mut a, ra) = FullPrefixBytes::verifier(salts()).unwrap();
        let (mut b, _) = FullPrefixBytes::verifier(salts()).unwrap();
        for _ in 0..130 {
            assert_eq!(a.sample(), b.sample());
            a.observe_slice(&[]);
        }
        assert_eq!(ra.lock().unwrap().salts.len(), 1);
    }
    #[test]
    fn previous_message_and_salt_remain_in_complete_prefix() {
        let (mut a, report) = FullPrefixBytes::verifier(salts()).unwrap();
        a.observe_slice(b"one");
        let _: u8 = a.sample();
        a.observe_slice(b"two");
        let _: u8 = a.sample();
        let r = report.lock().unwrap();
        let call = &r.calls[1];
        assert_eq!(call.round, 1);
        assert_eq!(call.block, 0);
        let mut expected = DOMAIN.to_vec();
        expected.extend(1u32.to_be_bytes());
        expected.extend(0u32.to_be_bytes());
        expected.extend(2u32.to_be_bytes());
        let first = [PROFILE, b"one"].concat();
        expected.extend((first.len() as u64).to_be_bytes());
        expected.extend(first);
        expected.extend(3u64.to_be_bytes());
        expected.extend(b"two");
        expected.extend(2u32.to_be_bytes());
        expected.extend([0; 64]);
        for _ in 0..8 {
            expected.extend(1u64.to_le_bytes());
        }
        assert_eq!(call.input, expected);
    }
    #[test]
    fn record_boundary_and_prior_salt_bind_challenges() {
        let (mut a, _) = FullPrefixBytes::verifier(salts()).unwrap();
        let (mut b, _) = FullPrefixBytes::verifier(salts()).unwrap();
        a.observe_slice(b"ab");
        b.observe_slice(b"a");
        let _ = a.sample();
        let _ = b.sample();
        a.observe_slice(b"c");
        b.observe_slice(b"bc");
        assert_ne!(a.sample_array::<64>(), b.sample_array::<64>());
        let mut changed = salts();
        changed[0][7] = 1;
        let (mut unchanged, _) = FullPrefixBytes::verifier(salts()).unwrap();
        let (mut c, _) = FullPrefixBytes::verifier(changed).unwrap();
        for challenger in [&mut unchanged, &mut c] {
            challenger.observe_slice(b"ab");
            let _ = challenger.sample();
            challenger.observe_slice(b"c");
        }
        assert_ne!(unchanged.sample_array::<64>(), c.sample_array::<64>());
    }
    #[test]
    fn prover_verifier_raw_byte_parity_and_all16_used() {
        let (mut prover, pr) = FullPrefixBytes::prover();
        let mut expected = vec![];
        for i in 0..MOVES {
            prover.observe_slice(&[i as u8]);
            expected.push(prover.sample_vec(130));
        }
        assert_complete(&pr).unwrap();
        let s = pr.lock().unwrap().salts.clone();
        let (mut verifier, vr) = FullPrefixBytes::verifier(s).unwrap();
        for (i, e) in expected.iter().enumerate() {
            verifier.observe_slice(&[i as u8]);
            assert_eq!(&verifier.sample_vec(130), e);
        }
        assert_complete(&vr).unwrap();
        assert_eq!(pr.lock().unwrap().calls, vr.lock().unwrap().calls);
    }
    #[test]
    #[should_panic(expected = "block bound exhausted")]
    fn block_exhaustion_fails_closed() {
        let (mut b, _) = FullPrefixBytes::verifier(salts()).unwrap();
        for _ in 0..(64 * 64 + 1) {
            let _ = b.sample();
        }
    }
    #[test]
    #[should_panic(expected = "round bound exhausted")]
    fn round_exhaustion_fails_closed() {
        let (mut b, _) = FullPrefixBytes::verifier(salts()).unwrap();
        for i in 0..17 {
            b.observe(i);
            let _ = b.sample();
        }
    }
    #[test]
    #[should_panic(expected = "history bound exhausted")]
    fn history_exhaustion_fails_closed() {
        let (mut b, _) = FullPrefixBytes::verifier(salts()).unwrap();
        b.observe_slice(&vec![0; MAX_HISTORY_BYTES]);
    }
}
