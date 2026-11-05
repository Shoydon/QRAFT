import { blake2b } from '@noble/hashes/blake2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { hexToBytes, numberToBytes, bytesToHex, type Hex } from 'viem';
import assetManifest from '../../../public/pq-v5/manifest.json';
import deployment from '../../../public/pq-deployment.json';
import { PQ_PROFILE, type PqNote, type PqNoteTree } from './note';

export interface PublicWithdrawalStatement {
  profile:typeof PQ_PROFILE;root:number[];nullifier:number[];context:number[];
  publicContext:{chainIdHex:string;poolHex:string;recipientHex:string;relayerHex:string;denomination:string;fee:string;deadline:string};
}
export function withdrawalContext(recipient:Hex,deadline:bigint):{digest:Hex;publicContext:PublicWithdrawalStatement['publicContext']}{
  const chainId=numberToBytes(deployment.chainId,{size:32});const pool=hexToBytes(deployment.pool as Hex);
  const recipientBytes=hexToBytes(recipient);const zero=new Uint8Array(20);
  if(recipientBytes.length!==20||BigInt(recipient)===0n||recipient.toLowerCase()===deployment.pool.toLowerCase())throw Error('Choose a nonzero recipient outside the pool.');
  const digest=bytesToHex(blake2b(concatBytes(new TextEncoder().encode('HIMITSU-WITHDRAW-CONTEXT-v2\0'),chainId,pool,zero,numberToBytes(BigInt(deployment.denominationWei),{size:16}),recipientBytes,zero,new Uint8Array(16),numberToBytes(deadline,{size:8})),{dkLen:64}));
  return {digest,publicContext:{chainIdHex:bytesToHex(chainId),poolHex:deployment.pool,recipientHex:recipient,relayerHex:bytesToHex(zero),denomination:deployment.denominationWei,fee:'0',deadline:String(deadline)}};
}
let assets:Promise<{moduleText:string;wasm:Uint8Array}>|null=null;
async function verifiedAssets(){
  if(!assets){assets=(async()=>{
    const fetchOne=async(name:'himitsu_hiding_wasm_feasibility.js'|'himitsu_hiding_wasm_feasibility_bg.wasm')=>{
      const response=await fetch(`/pq-v5/${name}`,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Could not load the PQ prover.');
      const bytes=new Uint8Array(await response.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(hash!==assetManifest.files[name])throw Error('The PQ prover does not match its pinned artifact hash.');return bytes;
    };
    const [js,wasm]=await Promise.all([fetchOne('himitsu_hiding_wasm_feasibility.js'),fetchOne('himitsu_hiding_wasm_feasibility_bg.wasm')]);return{moduleText:new TextDecoder().decode(js),wasm};
  })();assets.catch(()=>{assets=null;});}return assets;
}
export async function browserPqProof(note:PqNote,tree:PqNoteTree,index:number,recipient:Hex,deadline:bigint,onProgress:(label:string)=>void,signal:AbortSignal):Promise<{proof:Uint8Array;statement:PublicWithdrawalStatement}>{
  signal.throwIfAborted();onProgress('Loading the hash-pinned transparent prover');
  const {moduleText,wasm}=await verifiedAssets();signal.throwIfAborted();
  const context=withdrawalContext(recipient,deadline);
  const statement:PublicWithdrawalStatement={profile:PQ_PROFILE,root:Array.from(hexToBytes(tree.root())),nullifier:Array.from(hexToBytes(note.nullifier)),context:Array.from(hexToBytes(context.digest)),publicContext:context.publicContext};
  const moduleUrl=URL.createObjectURL(new Blob([moduleText],{type:'text/javascript'}));
  const workerSource=`import init,*as b from ${JSON.stringify(moduleUrl)};self.onmessage=async({data})=>{try{await init({module_or_path:data.wasm});const s=JSON.stringify(data.statement);const p=b.prove_withdrawal_v5(s,JSON.stringify(data.witness));self.postMessage({stage:'Checking the transparent proof locally'});if(!b.verify_withdrawal_v5(s,p))throw Error();self.postMessage({proof:p},[p.buffer]);}catch{self.postMessage({error:'The local PQ proof failed. Your note is unchanged.'});}self.close();};`;
  const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
  try{
    const proof=await new Promise<Uint8Array>((resolve,reject)=>{
      const worker=new Worker(workerUrl,{type:'module'});
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();};
      const cancel=()=>{cleanup();reject(new DOMException('Proof cancelled','AbortError'));};
      const timer=setTimeout(()=>{cleanup();reject(Error('PQ proving timed out. Nothing was submitted.'));},240000);
      signal.addEventListener('abort',cancel,{once:true});
      worker.onerror=()=>{cleanup();reject(Error('The browser could not run the PQ prover. Use a desktop Chromium browser with sufficient memory.'));};
      worker.onmessage=({data}:MessageEvent<{stage?:string;proof?:Uint8Array;error?:string}>)=>{
        if(data.stage){onProgress(data.stage);return;}cleanup();if(data.error){reject(Error(data.error));return;}
        if(!(data.proof instanceof Uint8Array)||data.proof.length<72||data.proof.length>16*1024*1024){reject(Error('Invalid PQ proof envelope.'));return;}resolve(data.proof);
      };
      onProgress('Generating the transparent withdrawal proof on this device');
      worker.postMessage({wasm,statement:{root:statement.root,nullifier:statement.nullifier,context:statement.context},witness:tree.witness(note,index)});
      if(signal.aborted)cancel();
    });return{proof,statement};
  }finally{URL.revokeObjectURL(moduleUrl);URL.revokeObjectURL(workerUrl);}
}
