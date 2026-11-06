import {relayPrivatePayment} from '@/lib/private-wallet/relay-service';
export const runtime='nodejs';
export const maxDuration=240;
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 try{const text=await request.text();if(text.length>16000)throw Error('Payment is too large');return Response.json(await relayPrivatePayment(JSON.parse(text)));}
 catch(error){return Response.json({error:error instanceof Error?error.message:'Payment submission failed; check its status before retrying'},{status:400});}
}
