import {ml_kem768} from '@noble/post-quantum/ml-kem.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {concatBytes} from '@noble/hashes/utils.js';
import {bytesToHex,hexToBytes,type Hex} from 'viem';
import {ENVELOPE_BYTES,FIELD,noteCommitment,ownerCommitment,validateNote,type PoolDomain,type PrivateNote} from './model';

const utf8=new TextEncoder();
const copy=(value:Uint8Array):Uint8Array<ArrayBuffer>=>new Uint8Array(value);
const random=(length:number)=>crypto.getRandomValues(new Uint8Array(length));
const derive=(master:Uint8Array,label:string,length:number)=>hkdf(sha256,master,utf8.encode('QRAFT_PRIVATE_WALLET_V1'),utf8.encode(label),length);
export interface PrivateKeys {master:Uint8Array;signingSeed:Uint8Array;spendingSecret:bigint;owner:bigint;receiving:ReturnType<typeof ml_kem768.keygen>}
export interface ReceivingAddress extends PoolDomain {version:1;owner:bigint;receivingKey:Uint8Array}
export function derivePrivateKeys(master:Uint8Array=random(32)):PrivateKeys {
 if(master.length!==32)throw Error('Invalid recovery secret');
 const spendingSecret=BigInt(bytesToHex(derive(master,'spend',31)))+1n;
 const seed=derive(master,'receive-ml-kem-768',64);
 try{return{master:copy(master),signingSeed:derive(master,'sign-ml-dsa-44',32),spendingSecret,owner:ownerCommitment(spendingSecret),receiving:ml_kem768.keygen(seed)};}finally{seed.fill(0);}
}
function base64(bytes:Uint8Array):string {let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64(text:string):Uint8Array {if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('Invalid encoding');return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
function sameDomain(a:PoolDomain,b:PoolDomain){return a.chainId===b.chainId&&a.genesisHash.toLowerCase()===b.genesisHash.toLowerCase()&&a.pool.toLowerCase()===b.pool.toLowerCase();}
export function encodePrivateAddress(domain:PoolDomain,keys:Pick<PrivateKeys,'owner'|'receiving'>):string {
 const data=utf8.encode(JSON.stringify([1,domain.chainId,domain.genesisHash.toLowerCase(),domain.pool.toLowerCase(),keys.owner.toString(),base64(keys.receiving.publicKey)]));
 return 'qraft1.'+base64(data)+'.'+bytesToHex(sha256(data).slice(0,8)).slice(2);
}
export function decodePrivateAddress(text:string,expected:PoolDomain):ReceivingAddress {
 if(text.length>4096)throw Error('Private address is too large');
 try{
  const parts=text.trim().split('.');if(parts.length!==3||parts[0]!=='qraft1')throw Error();
  const data=unbase64(parts[1]!);if(bytesToHex(sha256(data).slice(0,8)).slice(2)!==parts[2])throw Error();
  const v:unknown=JSON.parse(new TextDecoder().decode(data));
  if(!Array.isArray(v)||v.length!==6||v[0]!==1||!Number.isSafeInteger(v[1])||typeof v[2]!=='string'||!/^0x[0-9a-f]{64}$/.test(v[2])||typeof v[3]!=='string'||!/^0x[0-9a-f]{40}$/.test(v[3])||typeof v[4]!=='string'||!/^\d{1,77}$/.test(v[4])||typeof v[5]!=='string')throw Error();
  const result:ReceivingAddress={version:1,chainId:v[1],genesisHash:v[2] as Hex,pool:v[3] as Hex,owner:BigInt(v[4]),receivingKey:unbase64(v[5])};
  if(!sameDomain(result,expected))throw Error('This private address belongs to a different network or pool');
  if(result.owner<=0n||result.owner>=FIELD||result.receivingKey.length!==1184)throw Error();
  // Validate canonical ML-KEM public-key encoding using the library's FIPS check.
  const probe=ml_kem768.encapsulate(result.receivingKey);probe.sharedSecret.fill(0);
  return result;
 }catch(e){if(e instanceof Error&&e.message.includes('different network'))throw e;throw Error('Enter a complete, valid Qraft private address');}
}
export function createPrivateNote(domain:PoolDomain,owner:bigint,amount:bigint):PrivateNote {
 const fields={owner,amount,rho:BigInt(bytesToHex(random(31)))+1n};
 const note={...fields,commitment:noteCommitment(domain,fields)};validateNote(domain,note);return note;
}
const fixed=(value:bigint,length:number)=>hexToBytes(`0x${value.toString(16).padStart(length*2,'0')}`);
const aad=(domain:PoolDomain,commitment:bigint)=>utf8.encode(JSON.stringify(['qraft-note-v1',domain.chainId,domain.genesisHash.toLowerCase(),domain.pool.toLowerCase(),commitment.toString()]));
async function encryptionKey(shared:Uint8Array,context:Uint8Array):Promise<CryptoKey>{
 const key=hkdf(sha256,shared,sha256(context),utf8.encode('QRAFT_NOTE_AEAD_V1'),32);
 try{return await crypto.subtle.importKey('raw',copy(key),'AES-GCM',false,['encrypt','decrypt']);}finally{key.fill(0);shared.fill(0);}
}
export async function encryptNote(domain:PoolDomain,recipient:ReceivingAddress,note:PrivateNote):Promise<Uint8Array>{
 validateNote(domain,note);if(!sameDomain(domain,recipient)||recipient.owner!==note.owner)throw Error('Note recipient mismatch');
 const context=aad(domain,note.commitment),kem=ml_kem768.encapsulate(recipient.receivingKey),iv=random(12);
 const plain=concatBytes(fixed(note.owner,32),fixed(note.amount,16),fixed(note.rho,32));
 try{
  const key=await encryptionKey(kem.sharedSecret,context);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context},key,copy(plain));
  return concatBytes(new Uint8Array([1]),kem.cipherText,iv,new Uint8Array(encrypted));
 }finally{plain.fill(0);}
}
export async function decryptNote(domain:PoolDomain,keys:Pick<PrivateKeys,'receiving'|'owner'>,commitment:bigint,envelope:Uint8Array):Promise<PrivateNote|null>{
 if(envelope.length!==ENVELOPE_BYTES||envelope[0]!==1)return null;
 let plain:Uint8Array|undefined;
 try{
  const context=aad(domain,commitment),shared=ml_kem768.decapsulate(envelope.slice(1,1089),keys.receiving.secretKey),key=await encryptionKey(shared,context);
  plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:copy(envelope.slice(1089,1101)),additionalData:context},key,copy(envelope.slice(1101))));
  if(plain.length!==80)return null;
  const note={owner:BigInt(bytesToHex(plain.slice(0,32))),amount:BigInt(bytesToHex(plain.slice(32,48))),rho:BigInt(bytesToHex(plain.slice(48,80))),commitment};
  if(note.owner!==keys.owner)return null;validateNote(domain,note);return note;
 }catch{return null;}finally{plain?.fill(0);}
}
