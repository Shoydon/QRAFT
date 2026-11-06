import {provisionAtomicWallet} from '@/lib/atomic/service';
import type {Hex} from 'viem';
export const runtime='nodejs';
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 try{const text=await request.text();if(text.length>3000)throw Error('Invalid request');const body=JSON.parse(text);if(Object.keys(body).join(',')!=='publicKey')throw Error('Only the public key is accepted');return Response.json(await provisionAtomicWallet(body.publicKey as Hex));}
 catch(error){return Response.json({error:error instanceof Error?error.message:'Wallet deployment failed'},{status:400});}
}
