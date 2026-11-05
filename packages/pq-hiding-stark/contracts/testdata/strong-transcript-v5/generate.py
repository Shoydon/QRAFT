#!/usr/bin/env python3
"""Verify and encode public native spBCS challenge logs; never a witness."""
import json,hashlib,argparse
from pathlib import Path
from Crypto.Hash import cSHAKE256
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[4]
p=argparse.ArgumentParser();p.add_argument('--proof-dir',type=Path,default=ROOT/'.local/pq-v5-native');p.add_argument('--output-dir',type=Path,default=HERE);a=p.parse_args();out=a.output_dir;out.mkdir(parents=True,exist_ok=True)
f=json.loads((a.proof_dir/'fixture.json').read_text());calls=json.loads((a.proof_dir/'transcript-hashes.json').read_text());domain=b'HIMITSU-SPBCS-CH-V5'+bytes([0]);profile=b'HIMITSU-WITHDRAWAL-V5/q320-b16-e5'+bytes([0]);salt=bytes.fromhex(f['proofSaltHex']);assert len(salt)==64
(out/'proof-salt.abi').write_bytes(salt);items=[];values=[];indices=[]
for round,c in enumerate(calls):
 raw=bytes.fromhex(c['inputHex']);key=bytes.fromhex(c['keyHex']);stream=bytes.fromhex(c['streamHex']);wb=bytes.fromhex(c['writebackHex']);assert hashlib.blake2b(raw).digest()==key
 assert cSHAKE256.new(custom=b'HIMITSU-SPBCS-STREAM-V5',data=key+salt).read(2560)==stream and stream[:64]==wb
 assert raw.startswith(domain);at=len(domain)
 def take(n):
  global at
  v=raw[at:at+n];assert len(v)==n;at+=n;return v
 def u(n):return int.from_bytes(take(n),'big')
 assert take(64)==salt;statement=take(u(4));assert statement.startswith(profile);assert u(4)==round*2+1;count=u(4);assert count==2*round+1
 seen=[(u(4),take(u(8)))for _ in range(count)];assert at==len(raw)and seen[:-1]==items and seen[-1][0]==round*2
 record=seen[-1][1];(out/f'message-{round:02}.bin').write_bytes(record);items=seen+[(round*2+1,wb)]
 (out/'statement.bin').write_bytes(statement);(out/f'key-input-{round:02}.bin').write_bytes(raw);(out/f'key-{round:02}.bin').write_bytes(key);(out/f'stream-{round:02}.bin').write_bytes(stream)
 consumed=0;accepted=[]
 while len(accepted)<(320 if round==15 else 5):
  word=int.from_bytes(stream[2560-consumed-8:2560-consumed],'big');consumed+=8
  if round==15:accepted.append(word&65535)
  elif word<2**64-2**32+1:accepted.append(word)
 assert consumed==int(c['consumedBytes'])
 if round<15:values+=accepted
 else:indices=accepted
(out/'expected.abi').write_bytes(b''.join(v.to_bytes(32,'big')for v in values+indices))
ch={'alpha':values[:5],'zeta':values[5:10],'gamma':values[10:15],'betas':[values[i:i+5]for i in range(15,75,5)],'indices':indices}
(out/'challenges.json').write_text(json.dumps(ch,indent=2)+'\n');(a.proof_dir/'challenges.json').write_text(json.dumps(ch,indent=2)+'\n')
(out/'summary.json').write_text(json.dumps({'all16NativeKeysAndCShakeStreamsVerified':True,'allPreviousItemsVerified':True,'logicalMoves':16,'publicOnly':True,'sourceFixtureSha256':hashlib.sha256((a.proof_dir/'fixture.json').read_bytes()).hexdigest(),'sourceProofSha256':hashlib.sha256((a.proof_dir/'proof.postcard').read_bytes()).hexdigest()},indent=2)+'\n')
print('Verified16 spBCS key/fullstream/writeback/item histories and all5/320samples')
