import { sha3_512 } from '@noble/hashes/sha3.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { bytesToHex, hexToBytes, type Hex } from 'viem';

export const PQ_PROFILE = 'himitsu-withdrawal-v5-spbcs-stream-writeback-goldilocks5-q320-b16' as const;
const PREFIX = 'qraft-pq-note-v1:';
export interface PqDeployment {
  readonly chainId: number;
  readonly genesisHash: Hex;
  readonly pool: Hex;
  readonly denominationWei: string;
}
export interface PqNote extends PqDeployment {
  readonly profile: typeof PQ_PROFILE;
  readonly secret: Hex;
  readonly commitment: Hex;
  readonly nullifier: Hex;
}
const digest = (bytes: Uint8Array): Hex => bytesToHex(sha3_512(bytes));
export function derivePqNote(deployment: PqDeployment, secret: Uint8Array): PqNote {
  if (secret.length !== 64) throw Error('A PQ note requires a fresh 64-byte secret.');
  return { ...deployment, profile: PQ_PROFILE, secret: bytesToHex(secret), commitment: digest(secret), nullifier: digest(secret.subarray(0, 32)) };
}
export function createPqNote(deployment: PqDeployment): PqNote {
  const secret = crypto.getRandomValues(new Uint8Array(64));
  try { return derivePqNote(deployment, secret); } finally { secret.fill(0); }
}
const checksum = (body: string) => bytesToHex(blake2b(new TextEncoder().encode(body), { dkLen:64 })).slice(2);
export function serializePqNote(note: PqNote): string {
  const body=JSON.stringify([note.profile,note.chainId,note.genesisHash,note.pool,note.denominationWei,note.secret]);
  return `${PREFIX}${body}:${checksum(body)}`;
}
export function parsePqNote(input: string, deployment: PqDeployment): PqNote {
  const text=input.trim();
  if(text.length>8192||!text.startsWith(PREFIX)) throw Error('Choose a QRAFT PQ note file. Classical notes cannot be used with this pool.');
  const end=text.lastIndexOf(':');
  const body=text.slice(PREFIX.length,end);
  if(checksum(body)!==text.slice(end+1)) throw Error('The note checksum does not match. Restore the saved file.');
  let fields:unknown;
  try{fields=JSON.parse(body);}catch{throw Error('The note file is malformed.');}
  if(!Array.isArray(fields)||fields.length!==6) throw Error('Unsupported PQ note format.');
  const [profile,chainId,genesisHash,pool,denominationWei,secret]=fields;
  if(profile!==PQ_PROFILE||chainId!==deployment.chainId||genesisHash!==deployment.genesisHash||
    typeof pool!=='string'||pool.toLowerCase()!==deployment.pool.toLowerCase()||denominationWei!==deployment.denominationWei) throw Error('This note belongs to another pool, network or proof profile.');
  if(typeof secret!=='string'||!/^0x[0-9a-f]{128}$/.test(secret)) throw Error('The PQ note secret is invalid.');
  return derivePqNote(deployment,hexToBytes(secret as Hex));
}
export const splitDigest = (value: Hex): readonly [Hex,Hex] => {
  if(!/^0x[0-9a-fA-F]{128}$/.test(value)) throw Error('Expected a 512-bit digest.');
  return [`0x${value.slice(2,66)}`,`0x${value.slice(66)}`];
};
const pair = (left: Hex,right: Hex): Hex => digest(concatBytes(hexToBytes(left),hexToBytes(right)));
export class PqNoteTree {
  readonly leaves: Hex[]=[];
  readonly zeros: Hex[]=[];
  readonly emptyRoot: Hex;
  constructor(){
    let zero=`0x${'00'.repeat(64)}` as Hex;
    for(let level=0;level<32;level++){this.zeros.push(zero);zero=pair(zero,zero);}
    this.emptyRoot=zero;
  }
  insert(commitment:Hex):void{
    splitDigest(commitment);
    if(this.leaves.length>=2**32)throw Error('The PQ tree is full.');
    this.leaves.push(commitment.toLowerCase() as Hex);
  }
  layers():Hex[][]{
    const result=[this.leaves];
    for(let level=0;level<32;level++){
      const previous=result[level]!;const next:Hex[]=[];
      for(let i=0;i<previous.length;i+=2)next.push(pair(previous[i]!,previous[i+1]??this.zeros[level]!));
      result.push(next);
    }
    return result;
  }
  root():Hex{return this.layers()[32]![0]??this.emptyRoot;}
  witness(note:PqNote,index:number):{secret:number[];siblings:number[][];directions:boolean[]}{
    if(!Number.isSafeInteger(index)||index<0||this.leaves[index]!==note.commitment.toLowerCase())throw Error('The note is not at this authenticated tree index.');
    const layers=this.layers();const siblings:number[][]=[];const directions:boolean[]=[];
    for(let level=0;level<32;level++){
      siblings.push(Array.from(hexToBytes(layers[level]![index^1]??this.zeros[level]!)));
      directions.push((index&1)===1);index=Math.floor(index/2);
    }
    return {secret:Array.from(hexToBytes(note.secret)),siblings,directions};
  }
}
