//! Optional public-verifier hash-length accounting. Never records inputs/outputs.
#[cfg(feature = "hash-metrics")]
mod enabled {
    use std::collections::BTreeMap;
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    };
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    static LENGTHS: Mutex<BTreeMap<usize, u64>> = Mutex::new(BTreeMap::new());
    pub fn start() {
        LENGTHS.lock().unwrap().clear();
        ACTIVE.store(true, Ordering::SeqCst);
    }
    pub fn record(length: usize) {
        if ACTIVE.load(Ordering::Relaxed) {
            *LENGTHS.lock().unwrap().entry(length).or_default() += 1;
        }
    }
    pub fn finish() -> BTreeMap<usize, u64> {
        ACTIVE.store(false, Ordering::SeqCst);
        LENGTHS.lock().unwrap().clone()
    }
}
#[cfg(feature = "hash-metrics")]
pub use enabled::*;
#[cfg(not(feature = "hash-metrics"))]
pub fn record(_: usize) {}
