import init, * as binding from './qraft_hiding_wasm_feasibility.js';
self.onmessage=async({data})=>{
 try {
  const exports=await init();const start=performance.now();let result;
  if(data.op==='diagnostic')result=JSON.parse(binding.diagnostic());
  else if(data.op==='profile')result=binding.public_vk_hex();
  else if(data.op==='prove')result=binding.prove(JSON.stringify(data.statement),JSON.stringify(data.witness));
  else if(data.op==='verify')result=binding.verify(JSON.stringify(data.statement),data.proof);
  else throw new Error();
  const response={ok:true,result,elapsedMs:performance.now()-start,linearMemoryBytes:exports.memory.buffer.byteLength};
  self.postMessage(response,result instanceof Uint8Array?[result.buffer]:[]);
 }catch {self.postMessage({ok:false,error:'Local membership operation failed'});}
 self.close();
};
