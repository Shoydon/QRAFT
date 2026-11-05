#!/usr/bin/env python3
"""Independent polynomial arithmetic on genuine public v3 proof; no witness export."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[4]
b=ROOT/'packages/pq-hiding-stark/benchmark-results/evm-v3'
f=json.loads((b/'fixture.json').read_text());ch=json.loads((ROOT/'packages/pq-hiding-stark/contracts/testdata/full-prefix/decoded.json').read_text());ch['batchAlpha']=ch['gamma'];p=2**64-2**32+1
z=[0]*5;one=[1,0,0,0,0]
def add(a,b):return[(x+y)%p for x,y in zip(a,b)]
def mul(a,b):
 c=[0]*9
 for i in range(5):
  for k in range(5):c[i+k]+=a[i]*b[k]
 for i in range(8,4,-1):c[i-5]+=3*c[i]
 return[x%p for x in c[:5]]
def project(vals):
 r=z
 for v in vals[::-1]:r=add(mul(r,ch['batchAlpha']),v if isinstance(v,list) else[v,0,0,0,0])
 return r
def ef(v):return list(map(int,v['value']))
def flat(v):
 if isinstance(v,list):
  for x in v:yield from flat(x)
 else:yield int(v)
def static(v):return b''.join(x.to_bytes(32,'big')for x in flat(v))
def dynamic(v):return len(v).to_bytes(32,'big')+v+b'\0'*((-len(v))%32)
hidden,fr=f['proof']['opening_proof'];o=f['proof']['opened_values']
claims=[]
def append(v,h):claims.append(list(map(ef,v+h)))
append(o['random'],hidden[0][0][0]);append(o['trace_local'],hidden[1][0][0]);append(o['trace_next'],hidden[1][0][1])
for i,v in enumerate(o['quotient_chunks']):append(v,hidden[2][i][0])
append(o['preprocessed_local'],[]);append(o['preprocessed_next'],[])
proj=list(map(project,claims));tot=[z,z];power=one
for i,vals in enumerate(claims):
 j=int(i in(2,20));tot[j]=add(tot[j],mul(proj[i],power))
 for _ in vals:power=mul(power,ch['batchAlpha'])
# Static ABI case: gamma,zeta,index,claimTotals,19 row projections,expected reduction.
expected=json.loads((b/'deep.json').read_text())['initialReducedValues']
manifest={'publicOnly':True,'source':'independent Python Fp5 arithmetic and authentic native proof rows','cases':[]}
for q in range(320):
 rows=[list(map(int,fr['input_openings'][0]['opened_values'][q][0])),list(map(int,fr['input_openings'][1]['opened_values'][q][0]))]+[list(map(int,v))for v in fr['input_openings'][2]['opened_values'][q]]+[list(map(int,fr['input_openings'][3]['opened_values'][q][0]))]
 data=static([ch['batchAlpha'],ch['zeta'],ch['indices'][q],tot,list(map(project,rows)),expected[q]])
 name=f'case-{q:03}.abi';(HERE/name).write_bytes(data);manifest['cases'].append({'file':name,'sha256':hashlib.sha256(data).hexdigest()})
 if q==0:
  for ri,vals in enumerate(rows):
   for ci,start in enumerate(range(0,len(vals),512)):
    v=vals[start:start+512];packed=b''.join(x.to_bytes(8,'little')for x in v)
    head=static([8*32,ch['batchAlpha'],project(v),len(v)])
    (HERE/f'base-{ri:02}-{ci}.abi').write_bytes(head+dynamic(packed))
for pi,vals in enumerate(claims):
 for ci,start in enumerate(range(0,len(vals),512)):
  v=vals[start:start+512];packed=b''.join(x.to_bytes(8,'little')for x in flat(v))
  head=static([8*32,ch['batchAlpha'],project(v),len(v)])
  # head: offset +5gamma +5expected +count =12words
  head=static([12*32,ch['batchAlpha'],project(v),len(v)])
  (HERE/f'extension-{pi:02}-{ci}.abi').write_bytes(head+dynamic(packed))
# fix base dynamic offsets also12words
for file in HERE.glob('base-*.abi'):
 data=file.read_bytes();file.write_bytes((12*32).to_bytes(32,'big')+data[32:])
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Generated320 reduction cases,19 row projections and21 claim projections in bounded chunks')
