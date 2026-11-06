#!/usr/bin/env python3
"""Encode public native-verified V5 vectors as standalone Solidity test fixtures.
No witness, keys, network, proving, signing or deployment. Uses exact Python integers.
"""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def location(p):
 p=Path(p);return p if p.is_absolute() else ROOT/p
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def word(n):return int(n).to_bytes(32,'big')
def tuple_encode(items):
 size=sum(32 if dyn else len(b) for b,dyn in items);head=b'';tail=b''
 for b,dyn in items:
  if dyn:head+=word(size+len(tail));tail+=b
  else:head+=b
 return head+tail
def dyn_array(values):return word(len(values))+tuple_encode([(b,True) for b in values])
def raw_hex(x):return bytes.fromhex(x.removeprefix('0x'))
def bts(b):return word(len(b))+b+b'\0'*((-len(b))%32)
def rows(values):return dyn_array([dyn_array([bts(raw_hex(x)) for x in q]) for q in values])
def digests(values):return word(len(values))+b''.join(raw_hex(x) for x in values)
def exts(values):return word(len(values))+b''.join(word(x) for a in values for x in a)
def opening(b,q):return tuple_encode([(rows([b['rows'][q]]),True),(rows([b['salts'][q]]),True),(digests(b['paths'][q]),True)])
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--proof',default='.local/pq-v5-native');p.add_argument('--inputs',default='.local/pq-evm-port/input-v5-vectors.json');p.add_argument('--fri',default='.local/pq-evm-port/fri-v5-vectors.json');p.add_argument('--output',default='packages/pq-hiding-stark/contracts/testdata/session-v5');a=p.parse_args()
 proof,ip,fp,out=map(location,[a.proof,a.inputs,a.fri,a.output]);out.mkdir(parents=True,exist_ok=True)
 source=json.loads((proof/'fixture.json').read_text());iv=json.loads(ip.read_text());fv=json.loads(fp.read_text())
 for vectors in [iv,fv]:
  assert vectors['wholeNativeV5ProofVerified']
  assert vectors['sourceFixtureSha256']==sha(proof/'fixture.json')
  assert vectors['sourceProofSha256']==sha(proof/'proof.postcard')
 inputs,fri=iv['batches'],fv['rounds'];assert len(inputs)==4 and len(fri)==12
 assert all(b['all320NativeSingletonsVerified'] for b in inputs)
 assert all(b['indices']==fri[0]['indices'] for b in inputs)
 for q in range(320):
  array=tuple_encode([(opening(b,q),True) for b in inputs]);(out/f'input-{q:03}.abi').write_bytes(tuple_encode([(array,True)]))
 for r,v in enumerate(fri):
  assert v['allSingletonPathsNativeVerified'] and len(v['subsets'])==10
  for i,s in enumerate(v['subsets']):
   assert s['nativeSubsetVerified'] and s['start']==i*32 and s['count']==32
   encoded=tuple_encode([(exts(s['sibling_values']),True),(rows(s['salts']),True),(digests(s['siblings']),True)])
   (out/f'fri-{r:02}-{s["start"]:03}.abi').write_bytes(encoded)
 material=b''.join(raw_hex(inputs[i]['root']) for i in [1,2,0])+b''.join(raw_hex(v['root']) for v in fri)
 material+=b''.join(word(x) for x in fv['final_constant'])+raw_hex(source['proofSaltHex'])
 assert len(material)==1184;(out/'material.abi').write_bytes(material)
 manifest={'schema':1,'genuineV5PublicOnly':True,'sourceFixtureSha256':sha(proof/'fixture.json'),'sourceProofSha256':sha(proof/'proof.postcard'),'inputBatches':4,'inputQueries':320,'friRounds':12,'friSubsets':120,'friSubsetSize':32,'allPathsAndSubsetsNativeVerified':True,'inputAbi':'(BlakeMerkleV5.Opening[4])','friAbi':'(uint256[5][],bytes[][],BlakeMerkleV5.Digest[])','materialAbi':'WithdrawalVerifierSessionV5.Material(allstatic)','materialRootsOrder':'trace(batch1),quotient(batch2),random(batch0),fri12,finalConstant5,singleproofsalt64B','source_sha256':{str(x):sha(x) for x in [ip,fp,proof/'fixture.json',Path(__file__)]},'fixtures':[{'file':f.name,'bytes':f.stat().st_size,'sha256':sha(f)} for f in sorted(out.glob('*.abi'))]}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({'inputSingletonABIs':320,'friSubsetABIs':120,'materialBytes':1184,'maxInputBytes':max(f.stat().st_size for f in out.glob('input-*.abi')),'maxFriSubsetBytes':max(f.stat().st_size for f in out.glob('fri-*.abi')),'sourceNativeVerified':True,'output':str(out)}))
if __name__=='__main__':main()
