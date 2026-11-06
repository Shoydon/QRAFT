/* Witnesses stay in this dedicated worker. No secret data is logged. */
self.onmessage=async({data})=>{
 try {
  importScripts(data.libraryUrl);
  const {proof,publicSignals}=await snarkjs.groth16.fullProve(data.witness,new Uint8Array(data.wasm),new Uint8Array(data.zkey),undefined,undefined,{singleThread:true});
  self.postMessage({stage:'Checking your payment'});
  if(!await snarkjs.groth16.verify(data.verificationKey,publicSignals,proof))throw Error('verification');
  const words=(await snarkjs.groth16.exportSolidityCallData(proof,publicSignals)).match(/0x[0-9a-fA-F]+/g);
  if(words.length!==22)throw Error('shape');
  self.postMessage({proof:words.slice(0,8).map(v=>BigInt(v).toString()),publicSignals});
 }catch{self.postMessage({error:'The private proof could not be generated. No payment was submitted.'});}
};
