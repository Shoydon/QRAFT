/** Restrict the optional local gas service to same-origin browser requests. */
export function requireLocalOrigin(request: Request): void {
  if(process.env.QRAFT_LOCAL_PQ_SERVICE!=='1')throw Error('The local PQ gas service is not enabled.');
  const url=new URL(request.url);
  const origin=request.headers.get('origin');const host=request.headers.get('host');
  if(!origin||!host)throw Error('PQ gas operations require this local app origin.');
  const browserOrigin=new URL(origin);
  // Next's internal URL may use "localhost" even when the actual Host is 127.0.0.1.
  // The server listener is bound to loopback; compare Origin with the browser's Host.
  if(!['localhost','127.0.0.1'].includes(url.hostname)||!['localhost','127.0.0.1'].includes(browserOrigin.hostname)||
    browserOrigin.protocol!==url.protocol||browserOrigin.host!==host)throw Error('PQ gas operations require this local app origin.');
}
export async function publicJson(request:Request,maxBytes:number):Promise<Record<string,unknown>>{
  const length=Number(request.headers.get('content-length')??0);
  if(length>maxBytes)throw Error('Request is too large.');
  const reader=request.body?.getReader();if(!reader)throw Error('Missing request body.');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw Error('Request is too large.');chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const json:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if(!json||typeof json!=='object'||Array.isArray(json))throw Error('Expected a public request object.');
  return json as Record<string,unknown>;
}
