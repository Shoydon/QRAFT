//! Public-only native/EVM differential fixture. Never serializes the witness.
use himitsu_direct_hiding_research::{authorization::{self,WithdrawalAir,WithdrawalContext},blake_config as bc,membership};
use p3_challenger::{HashChallenger,SerializingChallenger64};
use p3_field::PrimeCharacteristicRing;
use p3_symmetric::CryptographicHasher;
use p3_uni_stark::{StarkConfig,StarkGenericConfig,Proof,PreprocessedVerifierKey,prove_with_preprocessed,verify_with_preprocessed};
use rand::RngExt;
use serde_json::{json,Value};
use std::sync::Mutex;
static HASHES:Mutex<Vec<Value>>=Mutex::new(Vec::new());
#[derive(Clone)]struct TraceHasher;
fn hex(bytes:&[u8])->String {let mut s=String::with_capacity(2*bytes.len());for b in bytes {use std::fmt::Write;write!(&mut s,"{b:02x}").unwrap();}s}
impl CryptographicHasher<u8,[u8;64]> for TraceHasher {
 fn hash_iter<I:IntoIterator<Item=u8>>(&self,input:I)->[u8;64] {
  let input:Vec<u8>=input.into_iter().collect();let output=bc::Blake2b512Hash.hash_slice(&input);
  HASHES.lock().unwrap().push(json!({"inputHex":hex(&input),"outputHex":hex(&output)}));output
 }
}
type RecordedChallenger=SerializingChallenger64<bc::Val,HashChallenger<u8,TraceHasher,64>>;
type RecordedConfig=StarkConfig<bc::Pcs,bc::Challenge,RecordedChallenger>;
fn stringify_numbers(value:&mut Value) {match value {Value::Number(n)=>*value=Value::String(n.to_string()),Value::Array(v)=>for x in v {stringify_numbers(x)},Value::Object(v)=>for x in v.values_mut(){stringify_numbers(x)},_=>{}}}
fn main()->Result<(),Box<dyn std::error::Error>> {
 let out=std::env::args().nth(1).unwrap_or("benchmark-results/evm-v2".into());
 let out=std::path::Path::new(&out);std::fs::create_dir_all(out)?;
 let mut rng=rand::rng();let secret:[u8;64]=rng.random();let siblings:Vec<[u8;64]>=(0..32).map(|_|rng.random()).collect();let dirs:Vec<bool>=(0..32).map(|_|rng.random()).collect();
 let mut chain_id=[0;32];chain_id[30..].copy_from_slice(&1337_u16.to_be_bytes());
 let ctx=WithdrawalContext{chain_id,pool:[1;20],asset:[0;20],denomination:100_000_000_000_000,recipient:[2;20],relayer:[3;20],fee:0,deadline:1_800_000_000};
 let context=ctx.digest();let root=membership::root_and_nodes(secret,&siblings,&dirs).0;let nul=membership::digest(&secret[..32]);
 let public=authorization::public_values::<bc::Val>(root,nul,context);let cfg=bc::withdrawal_config();let air=WithdrawalAir;
 let(pd,vk)=bc::canonical_membership_preprocessing()?;
 let start=std::time::Instant::now();let proof=prove_with_preprocessed(&cfg,&air,authorization::trace(secret,&siblings,&dirs,context,4),&public,Some(&pd))?;let prove_ms=start.elapsed().as_secs_f64()*1000.;
 verify_with_preprocessed(&cfg,&air,&proof,&public,Some(&vk))?;
 for i in [0,32,64] {let mut changed=public.clone();changed[i]+=bc::Val::ONE;assert!(verify_with_preprocessed(&cfg,&air,&proof,&changed,Some(&vk)).is_err());}
 let encoded=postcard::to_allocvec(&proof)?;std::fs::write(out.join("proof.postcard"),&encoded)?;
 let recorded=RecordedConfig::new(cfg.pcs().clone(),RecordedChallenger::new(HashChallenger::new(b"HIMITSU-BLAKE2B-WITHDRAWAL-RESEARCH-v2/q320-b16-e5\0".to_vec(),TraceHasher)));
 let recorded_proof:Proof<RecordedConfig>=postcard::from_bytes(&encoded)?;
 let recorded_vk=PreprocessedVerifierKey::<RecordedConfig>{width:vk.width,degree_bits:vk.degree_bits,commitment:vk.commitment.clone()};
 verify_with_preprocessed(&recorded,&air,&recorded_proof,&public,Some(&recorded_vk))?;
 let mut fixture=json!({"profile":"himitsu-withdrawal-v2-blake2b512-goldilocks5-q320-b16","expectedPublic":public,"contextDigestHex":hex(&context),"rootHex":hex(&root),"nullifierHex":hex(&nul),"publicVk":{"width":vk.width,"degreeBits":vk.degree_bits,"commitment":vk.commitment},"proof":proof,"privateWitnessExported":false});
 stringify_numbers(&mut fixture);std::fs::write(out.join("fixture.json"),serde_json::to_vec(&fixture)?)?;
 let hashes=HASHES.lock().unwrap();std::fs::write(out.join("transcript-hashes.json"),serde_json::to_vec(&*hashes)?)?;
 let summary=json!({"experimental":true,"fullEvmVerification":false,"privateWitnessExported":false,"proofBytes":encoded.len(),"publicInputCount":public.len(),"traceWidth":authorization::WIDTH,"transcriptHashCalls":hashes.len(),"proveMs":prove_ms,"nativeVerified":true,"changedRootRejected":true,"changedNullifierRejected":true,"changedContextRejected":true});
 std::fs::write(out.join("summary.json"),serde_json::to_vec_pretty(&summary)?)?;println!("{summary}");Ok(())
}
