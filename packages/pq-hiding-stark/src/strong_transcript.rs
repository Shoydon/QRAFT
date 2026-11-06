//! Experimental two-layer spBCS-style transcript, with exact public raw logs.
//! This implementation is not itself a proof of the required RBR/HVZK/compiler map.
use crate::strong_config as bc;
use p3_challenger::{ByteGrindingChallenger, CanObserve, CanSample, SerializingChallenger64};
use p3_field::PrimeField64;
use p3_symmetric::CryptographicHasher;
use p3_uni_stark::{Proof, verify_with_preprocessed};
use rand::{TryRng, rngs::SysRng};
use std::sync::{Arc, Mutex};
use tiny_keccak::{CShake, Hasher};
pub const DOMAIN: &[u8] = b"QRAFT-SPBCS-CH-V5\0";
pub const PROFILE: &[u8] = b"QRAFT-WITHDRAWAL-V5/q320-b16-e5\0";
pub const STREAM_CUSTOM: &[u8] = b"QRAFT-SPBCS-STREAM-V5";
pub const STREAM_BYTES: usize = 2560;
pub const MOVES: usize = 16;
pub const MAX_HISTORY_BYTES: usize = 1 << 20;
pub const MAX_ENVELOPE_BYTES: usize = 16 << 20;
const MAGIC: &[u8; 8] = b"HMSPV5\0\0";
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OracleCall {
    pub round: u32,
    pub input: Vec<u8>,
    pub key: [u8; 64],
    pub stream: Vec<u8>,
    pub writeback: [u8; 64],
    pub consumed: usize,
}
#[derive(Clone, Debug)]
pub struct TranscriptReport {
    pub salt: [u8; 64],
    pub statement: Vec<u8>,
    pub calls: Vec<OracleCall>,
}
pub type Report = Arc<Mutex<TranscriptReport>>;
#[derive(Clone, Debug)]
pub struct StrongBytes {
    salt: [u8; 64],
    statement: Vec<u8>,
    items: Vec<(u32, Vec<u8>)>,
    pending: Vec<u8>,
    buffer: Vec<u8>,
    active: bool,
    history: usize,
    report: Report,
}
impl StrongBytes {
    fn new(statement: Vec<u8>, salt: [u8; 64]) -> (Self, Report) {
        let report = Arc::new(Mutex::new(TranscriptReport {
            salt,
            statement: statement.clone(),
            calls: vec![],
        }));
        (
            Self {
                salt,
                statement,
                items: vec![],
                pending: vec![],
                buffer: vec![],
                active: false,
                history: 0,
                report: report.clone(),
            },
            report,
        )
    }
    pub(crate) fn setup() -> Self {
        Self::new(vec![], [0; 64]).0
    }
    fn close_move(&mut self) {
        if !self.active {
            return;
        }
        let r = self.report.lock().unwrap();
        let call = r.calls.last().expect("v5 missing move");
        assert_eq!(
            call.consumed,
            expected_consumption(call),
            "v5 incomplete or excess logical sampling"
        );
        drop(r);
        self.active = false;
        self.buffer.clear();
    }
    fn begin_move(&mut self) {
        assert!(!self.pending.is_empty(), "v5 missing prover message");
        let round = self.report.lock().unwrap().calls.len();
        assert!(round < MOVES, "v5 move bound");
        self.history += self.pending.len();
        assert!(self.history <= MAX_HISTORY_BYTES, "v5 history bound");
        self.items
            .push(((2 * round) as u32, std::mem::take(&mut self.pending)));
        let mut input = DOMAIN.to_vec();
        input.extend(self.salt);
        input.extend((self.statement.len() as u32).to_be_bytes());
        input.extend(&self.statement);
        input.extend((2 * round as u32 + 1).to_be_bytes());
        input.extend((self.items.len() as u32).to_be_bytes());
        for (i, item) in &self.items {
            input.extend(i.to_be_bytes());
            input.extend((item.len() as u64).to_be_bytes());
            input.extend(item);
        }
        let key: [u8; 64] = bc::Blake2b512Hash.hash_slice(&input);
        let mut xof = CShake::v256(b"", STREAM_CUSTOM);
        xof.update(&key);
        xof.update(&self.salt);
        let mut stream = vec![0; STREAM_BYTES];
        xof.finalize(&mut stream);
        let writeback = stream[..64].try_into().unwrap();
        self.items
            .push(((2 * round + 1) as u32, stream[..64].to_vec()));
        self.history += 64;
        assert!(self.history <= MAX_HISTORY_BYTES, "v5 history bound");
        self.buffer = stream.clone();
        self.active = true;
        let mut log = self.report.lock().unwrap();
        assert_eq!(log.calls.len(), round, "v5 challenger reused");
        log.calls.push(OracleCall {
            round: round as u32,
            input,
            key,
            stream,
            writeback,
            consumed: 0,
        });
    }
}
fn expected_consumption(call: &OracleCall) -> usize {
    if call.round == 15 {
        return STREAM_BYTES;
    }
    let mut accepted = 0;
    for (i, word) in call.stream.rchunks_exact(8).enumerate() {
        if u64::from_be_bytes(word.try_into().unwrap()) < bc::Val::ORDER_U64 {
            accepted += 1;
            if accepted == 5 {
                return (i + 1) * 8;
            }
        }
    }
    usize::MAX
}
impl CanObserve<u8> for StrongBytes {
    fn observe(&mut self, value: u8) {
        self.close_move();
        assert!(
            self.history + self.pending.len() < MAX_HISTORY_BYTES,
            "v5 history bound"
        );
        self.pending.push(value);
    }
    fn observe_slice(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.close_move();
        assert!(
            bytes.len() <= MAX_HISTORY_BYTES - self.history - self.pending.len(),
            "v5 history bound"
        );
        self.pending.extend_from_slice(bytes);
    }
}
impl CanSample<u8> for StrongBytes {
    fn sample(&mut self) -> u8 {
        if !self.pending.is_empty() {
            self.begin_move();
        }
        assert!(self.active, "v5 no active move");
        let b = self.buffer.pop().expect("v5 bounded stream exhausted");
        self.report
            .lock()
            .unwrap()
            .calls
            .last_mut()
            .unwrap()
            .consumed += 1;
        b
    }
}
impl ByteGrindingChallenger for StrongBytes {}
pub type Challenger = SerializingChallenger64<bc::Val, StrongBytes>;
pub type Config = bc::Config;
fn statement(public: &[bc::Val]) -> Result<Vec<u8>, &'static str> {
    if public.len() != 96 || public.iter().any(|x| x.as_canonical_u64() > 65535) {
        return Err("v5 expected96 canonical u16 public fields");
    }
    let (_, vk) = bc::canonical_preprocessing()?;
    let mut result = PROFILE.to_vec();
    for digest in vk.commitment.roots() {
        for w in digest {
            result.extend(w.to_le_bytes());
        }
    }
    for x in public {
        result.extend(x.as_canonical_u64().to_le_bytes());
    }
    Ok(result)
}
pub fn prover_config(public: &[bc::Val]) -> Result<(Config, Report), &'static str> {
    let statement = statement(public)?;
    let mut salt = [0; 64];
    SysRng
        .try_fill_bytes(&mut salt)
        .map_err(|_| "v5 OS entropy unavailable")?;
    let (bytes, report) = StrongBytes::new(statement, salt);
    Ok((
        Config::new(bc::private_pcs(), Challenger::new(bytes)),
        report,
    ))
}
pub fn assert_complete(report: &Report) -> Result<(), &'static str> {
    let r = report.lock().map_err(|_| "v5 log failure")?;
    if r.calls.len() != MOVES
        || r.calls.iter().enumerate().any(|(i, c)| {
            c.round as usize != i
                || c.stream.len() != STREAM_BYTES
                || c.consumed != expected_consumption(c)
        })
    {
        return Err("v5 incomplete transcript");
    }
    Ok(())
}
pub struct Envelope {
    pub salt: [u8; 64],
    pub proof: Proof<Config>,
}
impl Envelope {
    pub fn to_bytes(&self) -> Result<Vec<u8>, postcard::Error> {
        let p = postcard::to_allocvec(&self.proof)?;
        if p.len() > MAX_ENVELOPE_BYTES - 72 {
            return Err(postcard::Error::SerializeBufferFull);
        }
        let mut out = MAGIC.to_vec();
        out.extend(self.salt);
        out.extend(p);
        Ok(out)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, postcard::Error> {
        if bytes.len() < 73 || bytes.len() > MAX_ENVELOPE_BYTES || &bytes[..8] != MAGIC {
            return Err(postcard::Error::DeserializeBadEncoding);
        }
        let (proof, trailing) = postcard::take_from_bytes(&bytes[72..])?;
        if !trailing.is_empty() {
            return Err(postcard::Error::DeserializeBadEncoding);
        }
        let result = Self {
            salt: bytes[8..72].try_into().unwrap(),
            proof,
        };
        if result.to_bytes()?.as_slice() != bytes {
            return Err(postcard::Error::DeserializeBadEncoding);
        }
        Ok(result)
    }
}
pub fn verify_envelope(
    envelope: &Envelope,
    public: &[bc::Val],
) -> Result<TranscriptReport, &'static str> {
    let statement = statement(public)?;
    let (_, vk) = bc::canonical_preprocessing()?;
    let (bytes, report) = StrongBytes::new(statement, envelope.salt);
    let cfg = Config::new(bc::private_pcs(), Challenger::new(bytes));
    let verified = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        verify_with_preprocessed(
            &cfg,
            &crate::authorization::WithdrawalAir,
            &envelope.proof,
            public,
            Some(&vk),
        )
    }));
    if !matches!(verified, Ok(Ok(()))) {
        return Err("v5 proof/transcript rejected");
    }
    assert_complete(&report)?;
    let out = report.lock().map_err(|_| "v5 log failure")?.clone();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bytes() -> (StrongBytes, Report) {
        StrongBytes::new(b"public-statement".to_vec(), [7; 64])
    }
    fn sample_extension(b: &mut StrongBytes) {
        let mut accepted = 0;
        while accepted < 5 {
            let word = u64::from_le_bytes(core::array::from_fn(|_| b.sample()));
            if word < bc::Val::ORDER_U64 {
                accepted += 1;
            }
        }
    }
    #[test]
    fn writeback_is_first_stream_bytes_and_enters_next_key() {
        let (mut b, r) = bytes();
        b.observe_slice(b"raw0");
        sample_extension(&mut b);
        let first = r.lock().unwrap().calls[0].clone();
        assert_eq!(first.writeback.as_slice(), &first.stream[..64]);
        b.observe_slice(b"raw1");
        sample_extension(&mut b);
        let log = r.lock().unwrap();
        assert_eq!(log.calls.len(), 2);
        let c = &log.calls[1];
        assert!(c.input.windows(64).any(|x| x == first.writeback));
        assert!(c.input.windows(4).any(|x| x == b"raw0"));
        assert!(c.input.windows(4).any(|x| x == b"raw1"));
    }
    #[test]
    fn one_joint_query_stream_has_no_refill() {
        let (mut b, r) = bytes();
        for i in 0..15 {
            b.observe(i);
            sample_extension(&mut b);
        }
        b.observe(15);
        for _ in 0..STREAM_BYTES {
            b.sample();
        }
        assert_complete(&r).unwrap();
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.sample())).is_err());
    }
    #[test]
    fn partial_move_cannot_be_closed() {
        let (mut b, _) = bytes();
        b.observe(0);
        b.sample();
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.observe(1))).is_err());
    }
    #[test]
    fn extra_sampling_cannot_be_hidden_by_observation() {
        let (mut b, _) = bytes();
        b.observe(0);
        sample_extension(&mut b);
        b.sample();
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.observe(1))).is_err());
    }
    #[test]
    fn salt_statement_and_prover_bytes_bind_key() {
        let mut keys = vec![];
        for (statement, salt, message) in [
            (b"a".to_vec(), [0; 64], b"m".as_slice()),
            (b"b".to_vec(), [0; 64], b"m".as_slice()),
            (b"a".to_vec(), [1; 64], b"m".as_slice()),
            (b"a".to_vec(), [0; 64], b"n".as_slice()),
        ] {
            let (mut b, r) = StrongBytes::new(statement, salt);
            b.observe_slice(message);
            sample_extension(&mut b);
            keys.push(r.lock().unwrap().calls[0].key);
        }
        for i in 0..keys.len() {
            for j in i + 1..keys.len() {
                assert_ne!(keys[i], keys[j]);
            }
        }
    }
    #[test]
    fn empty_observation_preserves_sampling() {
        let (mut a, ra) = bytes();
        let (mut b, rb) = bytes();
        a.observe(1);
        b.observe(1);
        for _ in 0..40 {
            assert_eq!(a.sample(), b.sample());
            a.observe_slice(&[]);
        }
        assert_eq!(ra.lock().unwrap().calls, rb.lock().unwrap().calls);
    }
    #[test]
    fn invalid_public_rejected_before_configuration() {
        assert!(statement(&[]).is_err());
        use p3_field::PrimeCharacteristicRing;
        assert!(statement(&vec![bc::Val::from_u64(65536); 96]).is_err());
    }
    #[test]
    fn empty_and_wrong_envelopes_rejected() {
        for bad in [vec![], vec![0; 72], vec![0; MAX_ENVELOPE_BYTES + 1]] {
            assert!(Envelope::from_bytes(&bad).is_err());
        }
    }
}
