export type PrivateProof=[bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint];
export async function provePrivate(witness:Record<string,unknown>,signals:string[],onStatus:(status:string)=>void,signal?:AbortSignal):Promise<PrivateProof>{
 onStatus('Loading verified proof files');
 const manifest=await fetch('/private-proving/manifest.json',{signal}).then(r=>{if(!r.ok)throw Error('Private proving files are not installed');return r.json();});
 const files=await Promise.all(['join-split.wasm','join-split.zkey','verification_key.json','snarkjs.min.js'].map(async name=>{
  const r=await fetch('/private-proving/'+name,{signal});if(!r.ok)throw Error('Could not load private proving files');const data=await r.arrayBuffer();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==manifest.files[name])throw Error('Private proving artifact integrity check failed');return data;
 }));
 if(signal?.aborted)throw Error('Payment preparation cancelled');
 onStatus('Proving on this device');
 return new Promise((resolve,reject)=>{
  const worker=new Worker('/private-prover.worker.js'),libraryUrl=URL.createObjectURL(new Blob([files[3]!],{type:'text/javascript'}));
  const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();URL.revokeObjectURL(libraryUrl);};
  const abort=()=>{clean();reject(Error('Payment preparation cancelled'));};
  const timer=setTimeout(()=>{clean();reject(Error('Proof generation timed out. No payment was submitted.'));},240000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onerror=()=>{clean();reject(Error('Proof worker failed. No payment was submitted.'));};
  worker.onmessage=({data})=>{if(data.stage){onStatus(data.stage);return;}clean();if(data.error){reject(Error(data.error));return;}
   if(JSON.stringify(data.publicSignals)!==JSON.stringify(signals)||data.proof?.length!==8){reject(Error('Proof does not match the reviewed payment'));return;}
   resolve(data.proof.map(BigInt) as PrivateProof);
  };
  worker.postMessage({witness,wasm:files[0],zkey:files[1],verificationKey:JSON.parse(new TextDecoder().decode(files[2])),libraryUrl});
 });
}
