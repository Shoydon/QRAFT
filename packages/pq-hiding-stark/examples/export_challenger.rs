use himitsu_direct_hiding_research::blake_config as bc;
use p3_challenger::{CanObserve,CanSample,CanSampleBits};
use p3_field::{PrimeCharacteristicRing,PrimeField64,BasedVectorSpace};
use p3_symmetric::Hash;
use p3_uni_stark::StarkGenericConfig;
fn main()->Result<(),Box<dyn std::error::Error>> {
 let cfg=bc::withdrawal_config();let mut c=cfg.initialise_challenger();
 let fields=[bc::Val::ZERO,bc::Val::ONE,bc::Val::NEG_ONE,bc::Val::from_u64(0x123456789abcdef)];
 c.observe_slice(&fields);let a:bc::Challenge=c.sample();let bits0=c.sample_bits(0);let bits13=c.sample_bits(13);
 c.observe_slice(&[] as &[bc::Val]);let b:bc::Challenge=c.sample();
 let digest=core::array::from_fn::<u8,64,_>(|i|i as u8);c.observe(Hash::<bc::Val,u8,64>::from(digest));
 let d:bc::Challenge=c.sample();let bits63=c.sample_bits(63);
 let limbs=|v:bc::Challenge| <bc::Challenge as BasedVectorSpace<bc::Val>>::as_basis_coefficients_slice(&v).iter().map(|x|x.as_canonical_u64().to_string()).collect::<Vec<_>>();
 let j=serde_json::json!({"domain":"HIMITSU-BLAKE2B-WITHDRAWAL-RESEARCH-v2/q320-b16-e5\u{0}","fields":fields.iter().map(|x|x.as_canonical_u64().to_string()).collect::<Vec<_>>(),"a":limbs(a),"bits0":bits0,"bits13":bits13,"bAfterEmptyObserve":limbs(b),"dAfterDigest":limbs(d),"bits63":bits63});
 std::fs::create_dir_all("contracts/testdata/transcript")?;std::fs::write("contracts/testdata/transcript/native.json",serde_json::to_vec_pretty(&j)?)?;println!("Native challenger fixture generated");Ok(())
}
