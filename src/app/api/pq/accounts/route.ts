import type { Hex } from 'viem';
import { provisionPqAccount, serviceEnabled } from '@/lib/pq/service';
import { publicJson, requireLocalOrigin } from '@/lib/pq/api';
export async function GET(){return Response.json({enabled:serviceEnabled(),userAuthorization:'ML-DSA-44',gasCarrier:'Local classical bootstrap/gas only; no user-custody authority'});}
export async function POST(request:Request){
  try{requireLocalOrigin(request);const body=await publicJson(request,4096);
    if(Object.keys(body).length!==1||typeof body.publicKey!=='string')throw Error('Only a public ML-DSA key is accepted.');
    return Response.json(await provisionPqAccount(body.publicKey as Hex));
  }catch(error){return Response.json({error:error instanceof Error?error.message.split('\n')[0]:'PQ account provisioning failed.'},{status:400});}
}
