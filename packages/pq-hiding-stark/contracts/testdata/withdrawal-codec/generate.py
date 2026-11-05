#!/usr/bin/env python3
import json,importlib.util,hashlib
from pathlib import Path
SOURCE=Path(__file__).resolve().parent;R=SOURCE.parents[4];pkg=R/'packages/pq-hiding-stark'
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--fixture-dir',type=Path,default=pkg/'benchmark-results/evm-v3');parser.add_argument('--challenges',type=Path,default=pkg/'contracts/testdata/full-prefix/decoded.json');parser.add_argument('--output-dir',type=Path,default=SOURCE);args=parser.parse_args()
H=args.output_dir;H.mkdir(parents=True,exist_ok=True);b=args.fixture_dir;f=json.loads((b/'fixture.json').read_text());ch=json.loads(args.challenges.read_text());o=f['proof']['opened_values'];hidden=f['proof']['opening_proof'][0]
def v(vals):return b''.join(int(x).to_bytes(8,'little')for a in vals for x in a['value'])
fields=[v(o['trace_local']),v(o['trace_next']),v(o['preprocessed_local']),v(o['preprocessed_next']),b''.join(v(a)for a in o['quotient_chunks']),v(o['random']),v(hidden[0][0][0]),v(hidden[1][0][0]),v(hidden[1][0][1]),b''.join(v(a[0])for a in hidden[2])]
def u(x):return x.to_bytes(32,'big')
def dyn(b):return u(len(b))+b+b'\0'*((-len(b))%32)
tail=b'';head=b''
for item in fields:head+=u(32*len(fields)+len(tail));tail+=dyn(item)
(H/'claims.abi').write_bytes(u(32)+head+tail)
def cap(c):
 if isinstance(c,dict)and'idx'in c:c=c['cap']
 return b''.join(int(x).to_bytes(8,'little')for x in c['cap'][0])
roots=[cap(f['proof']['commitments'][x])for x in ['trace','quotient_chunks','random']]+[cap(x)for x in f['proof']['opening_proof'][1]['commit_phase_commits']]
(H/'roots.bin').write_bytes(b''.join(roots));(H/'statement.bin').write_bytes(b''.join(bytes.fromhex(f[k])for k in ['rootHex','nullifierHex','contextDigestHex']))
(H/'final.bin').write_bytes(v(f['proof']['opening_proof'][1]['final_poly']))
# Independent actual AIR evaluation with the same pinned compiled symbolic program.
spec=importlib.util.spec_from_file_location('compiler',pkg/'scripts/compile-air.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=m.P;z=tuple(ch['zeta']);one=(1,0,0,0,0)
def power(a,n):
 r=one
 while n:
  if n&1:r=m.mul(r,a)
  a=m.mul(a,a);n>>=1
 return r
def sub(a,b):return m.add(a,m.neg(b))
def div(a,b):return m.mul(a,power(b,p**5-2))
zh=sub(power(z,2048),one);w=pow(7,(p-1)//2048,p);last=(pow(w,p-2,p),0,0,0,0);sels=[div(zh,sub(z,one)),div(zh,sub(z,last)),sub(z,last)]
def vals(k):return[list(map(int,a['value']))for a in o[k]]
air={'local':vals('trace_local'),'next':vals('trace_next'),'prepLocal':vals('preprocessed_local'),'prepNext':vals('preprocessed_next'),'public':list(map(int,f['expectedPublic'])),'selectors':sels,'alpha':ch['alpha']}
window=b''.join(fields[:4])+b''.join(int(x).to_bytes(8,'little')for x in air['public'])+b''.join(x.to_bytes(8,'little')for a in sels for x in a)
assert len(window)==219768;(H/'air-window.bin').write_bytes(window)
acc=m.ZERO;prefixes=[acc]
for i in range(93):
 program=bytes.fromhex((pkg/f'contracts/testdata/air-program/batch-{i:03}.hex').read_text().strip()[2:]);acc,_,_=m.evaluate(program,air,acc);prefixes.append(acc)
(H/'prefixes.bin').write_bytes(b''.join(x.to_bytes(32,'big')for a in prefixes for x in a))
chunks=[[tuple(map(int,a['value']))for a in row]for row in o['quotient_chunks']]
s=[pow(7*pow(7,(p-1)//32768,p)**i%p,2048,p)for i in range(16)];uu=power(z,2048);q=m.ZERO
for i in range(16):
 weight=one
 for j in range(16):
  if i!=j:weight=m.mul(weight,div(sub(uu,(s[j],0,0,0,0)),((s[i]-s[j])%p,0,0,0,0)))
 chunk=m.ZERO
 for k in range(5):basis=[0]*5;basis[k]=1;chunk=m.add(chunk,m.mul(chunks[i][k],basis))
 q=m.add(q,m.mul(weight,chunk))
assert div(acc,zh)==q,'actual proof AIR quotient identity'
(H/'quotient.abi').write_bytes(b''.join(x.to_bytes(32,'big')for row in chunks for a in row for x in a))
(H/'summary.json').write_text(json.dumps({'profile':f['profile'],'sourceFixtureSha256':hashlib.sha256((b/'fixture.json').read_bytes()).hexdigest(),'sourceProofSha256':hashlib.sha256((b/'proof.postcard').read_bytes()).hexdigest(),'sourceEnvelopeSha256':hashlib.sha256((b/'envelope.postcard').read_bytes()).hexdigest(),'actualProofAirQuotientIdentity':True,'constraints':3744,'batches':93,'privateWitnessExported':False,'airWindowSha256':hashlib.sha256(window).hexdigest()},indent=2)+'\n')
print('Actual proof:93 AIR folds match quotient identity; canonical codec fixture prepared')
