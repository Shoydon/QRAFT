#!/usr/bin/env python3
"""Reproduce public native quotient/selector vectors in an isolated package copy."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess
HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[4]
PACKAGE=REPO/'packages/pq-hiding-stark'
p=argparse.ArgumentParser();p.add_argument('--fixture',type=pathlib.Path,default=PACKAGE/'benchmark-results/evm-v2');p.add_argument('--cargo',default=str(pathlib.Path.home()/'.cargo/bin/cargo'));args=p.parse_args()
work=REPO/'.local/pq-claim/quotient/reproduce';source=work/'native';work.mkdir(parents=True,exist_ok=True)
shutil.copytree(PACKAGE,source,dirs_exist_ok=True,ignore=shutil.ignore_patterns('target','contracts','wasm','benchmark-results'))
shutil.copy2(HERE/'generate-native.rs',source/'examples/quotient_vectors.rs')
output=work/'native-vectors.json'
env=os.environ|{'HIMITSU_REPO':str(REPO),'QUOTIENT_PUBLIC_FIXTURE':str(args.fixture.resolve()),'QUOTIENT_VECTOR_OUTPUT':str(output),'CARGO_TARGET_DIR':str(work/'target')}
subprocess.run([args.cargo,'run','--locked','--release','--example','quotient_vectors'],cwd=source,env=env,check=True)
cases=json.loads(output.read_text())
def flat(v):
    if isinstance(v,list):
        for x in v:yield from flat(x)
    else:yield int(v)
manifest={'upstream':'0d803737b681774186cd283b1fd2d8e493655c82','native_functions':['p3_uni_stark::recompose_quotient_from_chunks','p3_commit::PolynomialSpace::selectors_at_point'],'sourceGenerator':'generate-native.rs','sourceSha256':hashlib.sha256((HERE/'generate-native.rs').read_bytes()).hexdigest(),'publicOnly':True,'cases':[]}
for i,c in enumerate(cases):
    data=b''.join(v.to_bytes(32,'big') for v in flat([c['zeta'],c['chunks'],c['quotient'],c['selectors'],c['selectorsValid'],c['accumulator']]))
    (HERE/f'case-{i:02}.abi').write_bytes(data)
    manifest['cases'].append({'index':i,'name':c['name'],'selectorsValid':c['selectorsValid'],'sha256':hashlib.sha256(data).hexdigest()})
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Generated {len(cases)} public-only native cases.')
