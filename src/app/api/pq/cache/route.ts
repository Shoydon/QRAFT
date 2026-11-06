import type { Hex } from 'viem';
import { cachePqAuthorization } from '@/lib/pq/service';
import { publicJson, requireLocalOrigin } from '@/lib/pq/api';
export async function POST(request:Request){
  try{requireLocalOrigin(request);const body=await publicJson(request,270000);
    if(Object.keys(body).some(key=>!['publicKey','raw','signature','address'].includes(key))||Object.keys(body).length<3||['publicKey','raw','signature'].some(key=>typeof body[key]!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(body[key] as string))||('address'in body&&(typeof body.address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(body.address))))throw Error('Only a public key, account, native transaction and ML-DSA signature are accepted.');
    return Response.json(await cachePqAuthorization(body.publicKey as Hex,body.raw as Hex,body.signature as Hex,body.address as Hex|undefined));
  }catch(error){return Response.json({error:error instanceof Error?error.message.split('\n')[0]:'PQ authorization preparation failed.'},{status:400});}
}
