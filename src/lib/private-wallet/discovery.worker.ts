import {hexToBytes,type Hex} from 'viem';
import {decryptNote,type PrivateKeys} from './crypto';
import {noteNullifier,type PoolDomain} from './model';
self.onmessage=async({data}:{data:{domain:PoolDomain;keys:Pick<PrivateKeys,'receiving'|'owner'|'spendingSecret'>;outputs:{commitment:bigint;index:number;envelope:Hex;blockNumber:bigint}[];spent:string[]}})=>{
 try{
  const spent=new Set(data.spent),notes=[];
  for(let i=0;i<data.outputs.length;i++){
   if(i%20===0)self.postMessage({progress:`Finding your payments · ${i} of ${data.outputs.length}`});
   const output=data.outputs[i]!,note=await decryptNote(data.domain,data.keys,output.commitment,hexToBytes(output.envelope));
   if(note&&!spent.has(noteNullifier(data.keys.spendingSecret,note.commitment).toString()))notes.push({...note,index:output.index,blockNumber:output.blockNumber});
  }
  self.postMessage({notes});
 }catch{self.postMessage({error:'Could not scan encrypted payments. Refresh to retry.'});}
 finally{data.keys.receiving.secretKey.fill(0);data.keys.spendingSecret=0n;}
};
