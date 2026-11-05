#!/usr/bin/env python3
"""Independent SP800185 cSHAKE256 vectors, Nempty/Sfixed, no witnesses."""
from pathlib import Path
from Crypto.Hash import cSHAKE256
import hashlib,json,random
h=Path(__file__).resolve().parent;r=random.Random(0x435348414b45)
pairs=[(bytes(64),bytes(64)),(bytes([255])*64,bytes([255])*64),(bytes(range(64)),bytes(range(64,128)))]+[(r.randbytes(64),r.randbytes(64))for _ in range(13)]
manifest=[]
for i,(key,salt)in enumerate(pairs):
 out=cSHAKE256.new(custom=b'HIMITSU-SPBCS-STREAM-V5',data=key+salt).read(2560)
 (h/f'case-{i:02}.bin').write_bytes(key+salt+out);manifest.append({'case':i,'sha256':hashlib.sha256(key+salt+out).hexdigest(),'outputBytes':2560})
(h/'manifest.json').write_text(json.dumps({'primitive':'SP800185-cSHAKE256','N':'','S':'HIMITSU-SPBCS-STREAM-V5','cases':manifest},indent=2)+'\n')
print('Generated16 independent full2560-byte cSHAKE256 vectors')
