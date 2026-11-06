import {poseidon1,poseidon2} from 'poseidon-lite';
import {bytesToHex,type Hex} from 'viem';
export interface AtomicNote {kind:'qraft-atomic-note';version:1;chainId:1337;pool:Hex;denominationWei:string;nullifier:string;secret:string;commitment:Hex;nullifierHash:Hex}
export const hex32=(n:bigint):Hex=>`0x${n.toString(16).padStart(64,'0')}`;
export function createNote(pool:Hex,denominationWei:string):AtomicNote{
 const random=()=>BigInt(bytesToHex(crypto.getRandomValues(new Uint8Array(30))));
 const nullifier=random(),secret=random();
 return{kind:'qraft-atomic-note',version:1,chainId:1337,pool,denominationWei,nullifier:String(nullifier),secret:String(secret),commitment:hex32(poseidon2([nullifier,secret])),nullifierHash:hex32(poseidon1([nullifier]))};
}
export function parseNote(text:string,pool:Hex,amount:string):AtomicNote{
 if(text.length>8192)throw Error('Note is too large');const n=JSON.parse(text) as AtomicNote;
 if(n.kind!=='qraft-atomic-note'||n.version!==1||n.chainId!==1337||n.pool.toLowerCase()!==pool.toLowerCase()||n.denominationWei!==amount)throw Error('This note belongs to a different pool or proof version.');
 for(const value of[n.nullifier,n.secret])if(!/^\d{1,73}$/.test(value)||BigInt(value)>=1n<<240n)throw Error('Invalid note secret');
 if(n.commitment!==hex32(poseidon2([BigInt(n.nullifier),BigInt(n.secret)]))||n.nullifierHash!==hex32(poseidon1([BigInt(n.nullifier)])))throw Error('Invalid note commitment');return n;
}
