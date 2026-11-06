use qraft_direct_hiding_research::{authorization::WithdrawalAir,blake_config as bc};
use p3_challenger::CanObserve;
use p3_field::PrimeField64;
use p3_fri::{PcsShape,FriShape};
use p3_uni_stark::StarkShape;
struct Recorder(Vec<u8>);
impl CanObserve<bc::Val> for Recorder {fn observe(&mut self,v:bc::Val){self.0.extend(v.as_canonical_u64().to_le_bytes());}}
fn hex(b:&[u8])->String{b.iter().map(|b|format!("{b:02x}")).collect()}
fn main()->Result<(),Box<dyn std::error::Error>>{
 let mut s=Recorder(vec![]);StarkShape::new::<bc::Val,_>(&WithdrawalAir,6,12,11,16,true,0).domain_separator::<bc::Val,bc::Challenge>().seed(&mut s);
 let shape=PcsShape{claimed_evaluation_counts:vec![vec![vec![10]],vec![vec![2735,2735]],vec![vec![10];16],vec![vec![6,6]]],batch_pow_bits:0};
 let mut p=Recorder(vec![]);shape.domain_separator::<bc::Val,bc::Challenge>().seed(&mut p);
 let mut f=Recorder(vec![]);FriShape::new(&bc::fri_parameters(()),&[16],16).domain_separator::<bc::Val,bc::Challenge>().seed(&mut f);
 let j=serde_json::json!({"profileDomainHex":hex(b"QRAFT-BLAKE2B-WITHDRAWAL-RESEARCH-v2/q320-b16-e5\0"),"starkSeedHex":hex(&s.0),"pcsSeedHex":hex(&p.0),"friSeedHex":hex(&f.0)});
 std::fs::create_dir_all("contracts/testdata/transcript")?;std::fs::write("contracts/testdata/transcript/shapes.json",serde_json::to_vec_pretty(&j)?)?;println!("Fixed profile transcript framing exported");Ok(())
}
