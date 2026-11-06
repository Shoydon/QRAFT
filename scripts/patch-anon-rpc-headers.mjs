/** Preserve JSON Content-Type through browser-harness 0.4.0 -> Nym mix-fetch.
 * Only the host's HeadersInit serialization changes. Worker bytes, hash checks,
 * sandboxing and network routing are unchanged. Fail closed on upstream drift.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const pkg=JSON.parse(await readFile(require.resolve('@anon-rpc/browser-harness/package.json'),'utf8'));
if(pkg.version!=='0.4.0')throw Error('Review the Anon-RPC header compatibility patch for this harness version.');
const path=require.resolve('@anon-rpc/browser-harness');
const original='if (headers.length) requestInit.headers = headers;';
const patched='if (headers.length) requestInit.headers = Object.fromEntries(headers);';
const source=await readFile(path,'utf8');
if(source.includes(patched)&&!source.includes(original))process.exit(0);
if(source.split(original).length!==2||source.includes(patched))throw Error('Unexpected Anon-RPC header serializer; refusing to patch.');
await writeFile(path,source.replace(original,patched));
console.log('Applied Anon-RPC JSON header compatibility patch.');
