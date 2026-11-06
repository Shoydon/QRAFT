import { requireLocalOrigin,publicJson } from '@/lib/pq/api';
import { proofJob,proofMaterial,uploadPublicData,verifyPublicSession } from '@/lib/pq/jobs';
import type { Hex } from 'viem';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{const{id}=await context.params;const job=await proofJob(id);return Response.json({...job,...(job.claimsBlob?{material:await proofMaterial(id)}:{})});}catch{return Response.json({error:'Unknown public proof.'},{status:404});}}
export async function POST(request:Request,context:Context){try{requireLocalOrigin(request);const{id}=await context.params;const body=await publicJson(request,256);
 if(body.action==='upload'&&Object.keys(body).length===1)return Response.json(await uploadPublicData(id));
 if(body.action==='verify'&&Object.keys(body).length===2&&typeof body.sessionId==='string')return Response.json(await verifyPublicSession(id,body.sessionId as Hex));
 throw Error('Invalid public proof action.');
 }catch(error){return Response.json({error:error instanceof Error?error.message.split('\n')[0]:'Public proof operation failed.'},{status:400});}}
