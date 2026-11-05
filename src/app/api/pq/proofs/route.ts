import { requireLocalOrigin } from '@/lib/pq/api';
import { acceptPublicProof } from '@/lib/pq/jobs';
export async function POST(request:Request){
 try{requireLocalOrigin(request);const statement=request.headers.get('x-qraft-public-statement');if(!statement)throw Error('A separate public statement is required.');
 const reader=request.body?.getReader();if(!reader)throw Error('Missing public proof.');const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024)throw Error('Public proof size limit.');chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 return Response.json(await acceptPublicProof(bytes,statement));
 }catch(error){return Response.json({error:error instanceof Error?error.message.split('\n')[0]:'Public proof encoding failed.'},{status:400});}
}
