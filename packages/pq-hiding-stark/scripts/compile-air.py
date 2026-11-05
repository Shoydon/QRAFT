#!/usr/bin/env python3
"""Compile the exact exported WithdrawalAir DAG into pinned bounded RPN batches.
No proving/security/deployment claim. Standard-library only; rerun native export first.
"""
import argparse, hashlib, json, struct
from pathlib import Path
P = 18446744069414584321
WIDTH, PUBLIC, PREP, ROWS, DEGREE, COUNT, BATCH = 2730, 96, 6, 2048, 7, 3744, 64
ZERO = (0,)*5

def add(a,b): return tuple((x+y)%P for x,y in zip(a,b))
def neg(a): return tuple(-x%P for x in a)
def mul(a,b):
    c=[0]*9
    for i,x in enumerate(a):
        for j,y in enumerate(b): c[i+j]=(c[i+j]+x*y)%P
    for i in range(8,4,-1):c[i-5]=(c[i-5]+3*c[i])%P
    return tuple(c[:5])

def emit_batch(nodes, roots):
    # A symbolic DAG can share high-degree Keccak subexpressions extensively.
    # Preserve that sharing in bounded registers instead of expanding a giant tree.
    uses={}; visited=set()
    def visit(i):
        uses[i]=uses.get(i,0)+1
        if i in visited:return
        visited.add(i);n=nodes[i]
        for child in (n[1:] if n[0] in (9,10,11,12) else []): visit(child)
    for root in roots:visit(root)
    registers={}; code=bytearray()
    def emit(i):
        if i in registers:
            code.extend(bytes([15])+struct.pack('>H',registers[i]));return
        n=nodes[i];op=n[0]
        if op<=4:code.extend(bytes([op])+struct.pack('>H',n[1]))
        elif op<=7:code.append(op)
        elif op==8:code.extend(bytes([op])+struct.pack('>Q',n[1]))
        elif op==11:emit(n[1]);code.append(op)
        elif op in (9,10,12):emit(n[1]);emit(n[2]);code.append(op)
        else:raise ValueError('unsupported operation')
        if uses[i]>1 and op>=9:
            r=len(registers);assert r<65536;registers[i]=r
            code.extend(bytes([14])+struct.pack('>H',r))
    for root in roots:emit(root);code.append(13)
    return bytes(code),len(registers)

def evaluate(program,f,acc=ZERO):
    stack=[]; registers={};pos=0; peak=0; folds=0;alpha=tuple(f['alpha'])
    while pos<len(program):
        op=program[pos];pos+=1
        if op<=4:
            index=int.from_bytes(program[pos:pos+2],'big');pos+=2
            values=[f['local'],f['next'],f['prepLocal'],f['prepNext'],f['public']][op]
            x=values[index];stack.append((x,0,0,0,0) if op==4 else tuple(x))
        elif op<=7:stack.append(tuple(f['selectors'][op-5]))
        elif op==8:
            x=int.from_bytes(program[pos:pos+8],'big');pos+=8
            assert x<P;stack.append((x,0,0,0,0))
        elif op==11:stack[-1]=neg(stack[-1])
        elif op in (9,10,12):
            b=stack.pop();a=stack.pop()
            stack.append(add(a,b) if op==9 else add(a,neg(b)) if op==10 else mul(a,b))
        elif op in (14,15):
            index=int.from_bytes(program[pos:pos+2],'big');pos+=2
            if op==14:
                assert index==len(registers);registers[index]=stack[-1]
            else:stack.append(registers[index])
        elif op==13:
            assert len(stack)==1
            acc=add(mul(acc,alpha),stack.pop());folds+=1
        else:raise ValueError('unknown opcode')
        peak=max(peak,len(stack))
    assert not stack
    return acc,peak,folds

def compile_program(ast):
    assert (ast['width'],ast['publicFields'],ast['prepWidth'],ast['rows'],ast['degree'],ast['constraintCount'])==(WIDTH,PUBLIC,PREP,ROWS,DEGREE,COUNT)
    assert ast['format']=='HIMITSU-WITHDRAWAL-AIR-DAG-v1'
    assert ast['upstream']=='0d803737b681774186cd283b1fd2d8e493655c82'
    assert ast['fieldModulus']==str(P) and ast['extension']=='X^5-3'
    nodes=ast['nodes'];roots=ast['constraints'];assert len(roots)==COUNT
    for i,n in enumerate(nodes):
        op=n[0]
        if op<=4:assert 0<=n[1]<[WIDTH,WIDTH,PREP,PREP,PUBLIC][op]
        elif op==8:assert 0<=n[1]<P
        elif op in (9,10,12):assert n[1]<i and n[2]<i
        elif op==11:assert n[1]<i
        else:assert op in (5,6,7)
    compiled=[];start=0
    while start<COUNT:
        count=1
        best=emit_batch(nodes,roots[start:start+count])
        while count<BATCH and start+count<COUNT:
            candidate=emit_batch(nodes,roots[start:start+count+1])
            if len(candidate[0])>4096:break
            count+=1;best=candidate
        assert len(best[0])<=4096
        compiled.append((*best,start,count));start+=count
    return compiled

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir',default='.local/pq-air-export')
    parser.add_argument('--output-dir',default='packages/pq-hiding-stark/contracts/testdata/air-program')
    args=parser.parse_args();src=Path(args.input_dir);out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    ast=json.loads((src/'withdrawal-air.json').read_text());compiled=compile_program(ast);programs=[p for p,n,s,c in compiled];max_registers=max(n for p,n,s,c in compiled)
    header=b'HIMITSU-WITHDRAWAL-AIR-RPN-v1\0'+struct.pack('>IHHHBIII',WIDTH,PUBLIC,PREP,ROWS,DEGREE,COUNT,BATCH,len(programs))
    commitment=hashlib.blake2b(header+b''.join(struct.pack('>I',len(p))+p for p in programs),digest_size=64).hexdigest()
    peak=0;fixtures=[]
    for i in range(3):
        f=json.loads((src/f'ood-{i}.json').read_text());acc=ZERO;prefixes=[list(acc)]
        expected=ZERO
        for program,(_,_,start,count) in zip(programs,compiled):
            acc,stack,folds=evaluate(program,f,acc);peak=max(peak,stack);prefixes.append(list(acc))
            for value in f['constraintValues'][start:start+count]:expected=add(mul(expected,tuple(f['alpha'])),tuple(value))
            assert acc==expected and folds==count
        assert list(acc)==f['fold'],f'compiler differs from native fixture{i}'
        f['batchPrefixes']=prefixes
        flat=[x for key in ['local','next','prepLocal','prepNext'] for row in f[key] for x in row]+f['public']+[x for row in f['selectors'] for x in row]
        assert len(flat)==27471 and all(0<=x<P for x in flat)
        (out/f'values-{i}.hex').write_text('0x'+b''.join(struct.pack('<Q',x) for x in flat).hex())
        (out/f'ood-{i}.json').write_text(json.dumps(f,separators=(',',':'))+'\n');fixtures.append({'seed':f['seed'],'fold':list(acc)})
    batches=[]
    for i,p in enumerate(programs):
        (out/f'batch-{i:03}.hex').write_text('0x'+p.hex())
        batches.append({'index':i,'firstConstraint':compiled[i][2],'constraintCount':compiled[i][3],'bytes':len(p),'blake2b512':hashlib.blake2b(p,digest_size=64).hexdigest()})
    manifest={'format':'HIMITSU-WITHDRAWAL-AIR-RPN-v1','fieldModulus':str(P),'extension':'X^5-3','packedInputBytes':219768,'packedInputOrder':'local,next,prepLocal,prepNext,public,selectors; canonicalLE-u64; extensionlimbsascending','upstream':ast['upstream'],'astSha256':hashlib.sha256((src/'withdrawal-air.json').read_bytes()).hexdigest(),'programBlake2b512':commitment,'width':WIDTH,'publicFields':PUBLIC,'prepWidth':PREP,'rows':ROWS,'degree':DEGREE,'constraintCount':COUNT,'maxBatchConstraints':BATCH,'batchCount':len(programs),'maxStack':peak,'maxRegisters':max_registers,'maxProgramBytes':max(map(len,programs)),'programBytes':sum(map(len,programs)),'foldRule':ast['fold'],'batches':batches,'nativeFixtures':fixtures,'scope':'AIR evaluation primitive only; not a proof verifier, transcript or pool authorization'}
    (out/'withdrawal-air.json').write_bytes((src/'withdrawal-air.json').read_bytes())
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Tiny source fragment consumed by AirProgram.sol generation; public relation pins only.
    (out/'pins.txt').write_text('program='+commitment+'\nstack='+str(peak)+'\nmaxBytes='+str(max(map(len,programs)))+'\ndigests='+''.join(b['blake2b512'] for b in batches)+'\n')
    sol=Path('packages/pq-hiding-stark/contracts/src/AirProgram.sol')
    if sol.exists():
        meta=b''.join(struct.pack('>HHH',b['firstConstraint'],b['constraintCount'],b['bytes']) for b in batches).hex()
        pins='\n'.join([
          f'    uint256 public constant BATCH_COUNT = {len(programs)};',
          f'    uint256 public constant MAX_STACK = {peak};',
          f'    uint256 public constant MAX_REGISTERS = {max_registers};',
          f'    uint256 public constant MAX_PROGRAM_BYTES = {max(map(len,programs))};',
          f'    bytes32 public constant PROGRAM_HASH_HI = 0x{commitment[:64]};',
          f'    bytes32 public constant PROGRAM_HASH_LO = 0x{commitment[64:]};',
          '    bytes private constant DIGESTS = hex"'+''.join(b['blake2b512'] for b in batches)+'";',
          '    bytes private constant BATCH_META = hex"'+meta+'";'])
        text=sol.read_text();start=text.index('    // BEGIN GENERATED AIR PINS')+len('    // BEGIN GENERATED AIR PINS');end=text.index('    // END GENERATED AIR PINS')
        sol.write_text(text[:start]+'\n'+pins+'\n'+text[end:])
    print(json.dumps({k:manifest[k] for k in ['constraintCount','batchCount','maxStack','maxRegisters','maxProgramBytes','programBytes','programBlake2b512']},indent=2))

if __name__=='__main__':main()
