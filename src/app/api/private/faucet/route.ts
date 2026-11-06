import {isAddress} from 'viem';
import manifest from '../../../../../public/private-deployment.json';
export const runtime='nodejs';
const endpoint='https://altmempoolgateway.forshtat.com/rpc';
async function rpc(method:string,params:unknown[]=[]){
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000),cache:'no-store'});
 if(!response.ok)throw Error('Faucet is unavailable. Try again later.');
 const body=await response.json();if(body.error)throw Error(body.error.message??'Faucet request was rejected');return body.result;
}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 try{
  const text=await request.text();if(text.length>256)throw Error('Invalid faucet request');const body=JSON.parse(text);
  if(!body||Object.keys(body).join(',')!=='address'||typeof body.address!=='string'||!isAddress(body.address)||/^0x0{40}$/i.test(body.address))throw Error('Enter a valid public address');
  const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
  if(genesis?.hash?.toLowerCase()!==manifest.genesisHash.toLowerCase())throw Error('Faucet network does not match this wallet');
  const result=await rpc('skandha_explorer_faucet',[body.address]);
  if(!result||!/^0x[0-9a-fA-F]{64}$/.test(result.txHash)||!/^\d+$/.test(result.amount))throw Error('Faucet returned an unexpected response. Check your balance before requesting again.');
  return Response.json({txHash:result.txHash,amount:result.amount});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Faucet request failed'},{status:400});}
}
