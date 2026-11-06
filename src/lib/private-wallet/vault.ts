import {authenticate,fromBase64,toBase64,type VaultSession} from '../pq/vault';
import {derivePrivateKeys,type PrivateKeys} from './crypto';
import type {PoolDomain} from './model';
export interface PrivateVault {kind:'qraft-private-vault';version:1;metadata:VaultSession['metadata'];domain:PoolDomain;owner:string;iv:string;ciphertext:string}
const encoder=new TextEncoder();
const header=(vault:Omit<PrivateVault,'iv'|'ciphertext'>)=>encoder.encode(JSON.stringify(vault));
export async function sealPrivateWallet(keys:PrivateKeys,domain:PoolDomain,session:VaultSession):Promise<PrivateVault>{
 const base={kind:'qraft-private-vault' as const,version:1 as const,metadata:session.metadata,domain,owner:keys.owner.toString()},iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:header(base)},session.key,new Uint8Array(keys.master));
 return{...base,iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))};
}
export async function unlockPrivateWallet(vault:PrivateVault,domain:PoolDomain){
 if(vault.kind!=='qraft-private-vault'||vault.version!==1||JSON.stringify(vault.domain)!==JSON.stringify(domain)||vault.ciphertext.length>128)throw Error('Wallet belongs to a different pool or is invalid');
 const session=await authenticate(vault.metadata);
 const {iv,ciphertext,...base}=vault;
 const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(iv),additionalData:header(base)},session.key,fromBase64(ciphertext)));
 try{const keys=derivePrivateKeys(plain);if(keys.owner.toString()!==vault.owner)throw Error('Wallet identity changed');return{keys,session};}finally{plain.fill(0);}
}
export function erasePrivateKeys(keys:PrivateKeys){keys.master.fill(0);keys.signingSeed.fill(0);keys.receiving.secretKey.fill(0);keys.spendingSecret=0n;}
export async function encryptLocal(value:unknown,session:VaultSession):Promise<string>{
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('qraft-private-local-v1')},session.key,encoder.encode(JSON.stringify(value)));
 return JSON.stringify({iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))});
}
export async function decryptLocal<T>(text:string,session:VaultSession):Promise<T>{
 if(text.length>2_000_000)throw Error('Local journal is too large');const v=JSON.parse(text);
 const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(v.iv),additionalData:encoder.encode('qraft-private-local-v1')},session.key,fromBase64(v.ciphertext)));
 try{return JSON.parse(new TextDecoder().decode(bytes)) as T;}finally{bytes.fill(0);}
}

/** Portable encrypted vault; requires the original PRF-capable passkey. */
export function parsePrivateBackup(text:string,domain:PoolDomain):PrivateVault {
 if(text.length>16384)throw Error('Wallet backup is too large');
 try{
  const v=JSON.parse(text),m=v?.metadata;
  if(v.kind!=='qraft-private-vault'||v.version!==1||JSON.stringify(v.domain)!==JSON.stringify(domain)||typeof v.owner!=='string'||!/^\d{1,77}$/.test(v.owner)||!m||m.kind!=='qraft-passkey-wallet'||m.version!==1||typeof m.rpId!=='string'||m.rpId.length>253||typeof m.origin!=='string'||new URL(m.origin).hostname!==m.rpId||typeof m.credentialId!=='string'||m.credentialId.length>4096||fromBase64(m.credentialId).length===0||fromBase64(m.prfSalt).length!==32||fromBase64(m.hkdfSalt).length!==32||fromBase64(v.iv).length!==12||fromBase64(v.ciphertext).length!==48)throw Error();
  if(Object.keys(v).sort().join()!==['kind','version','metadata','domain','owner','iv','ciphertext'].sort().join())throw Error();
  return v;
 }catch{throw Error('Choose a valid passkey-protected backup for this pool');}
}
