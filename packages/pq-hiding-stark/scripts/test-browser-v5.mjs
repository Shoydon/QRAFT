import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=join(dirname(fileURLToPath(import.meta.url)),'../wasm');
const publicRoot=join(dirname(fileURLToPath(import.meta.url)),'../../../public/pq-v5');
const server=createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated membership WASM feasibility</title>');return;}
 if(req.url==='/favicon.ico'){res.statusCode=204;res.end();return;}
 const name=req.url.slice(1);if(!/^[a-zA-Z0-9_.-]+$/.test(name)){res.statusCode=404;res.end();return;}
 const file=join(publicRoot,name);if(!existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',extname(name)==='.wasm'?'application/wasm':'text/javascript');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch();
const exportPublic=process.argv.includes('--export-public-proof');
const publicOutput=join(dirname(fileURLToPath(import.meta.url)),'../../../.local/pq-v5-browser');
if(exportPublic)mkdirSync(publicOutput,{recursive:true});
const report={profile:'v5-spbcs',experimental:true,applicationEnabled:false,externalRequests:[],consoleEntries:[],errors:[]};
try{
 const page=await browser.newPage();page.on('request',r=>{if(!r.url().startsWith(base))report.externalRequests.push(r.url());});page.on('console',m=>report.consoleEntries.push({type:m.type(),text:m.text()}));page.on('pageerror',()=>report.errors.push('Browser page error'));
 await page.goto(base);await page.exposeFunction('capturePublicProof',({proofB64,statement})=>{if(!exportPublic)throw new Error('Public export not requested');writeFileSync(join(publicOutput,'public-proof.postcard'),Buffer.from(proofB64,'base64'));writeFileSync(join(publicOutput,'expected-public.json'),JSON.stringify(statement)+'\n');});await page.exposeFunction('progress',s=>process.stdout.write(s+'\n'));
 Object.assign(report,await page.evaluate(async(exportPublic)=>{
  const run=(data)=>new Promise((resolve,reject)=>{const w=new Worker('/worker-v5.js',{type:'module'});const t=setTimeout(()=>{w.terminate();reject(new Error('Worker timeout'));},180000);w.onmessage=({data:r})=>{clearTimeout(t);w.terminate();resolve(r);};w.onerror=()=>{clearTimeout(t);w.terminate();reject(new Error('Worker failed'));};w.postMessage(data);});
  const fixture=await run({op:'diagnostic'});if(!fixture.ok)throw new Error('Fixture failed');
  const {statement,witness}=fixture.result;const profile=await run({op:'profile'});if(!profile.ok)throw new Error('Profile failed');
  await window.progress('Proving actual v5 withdrawal AIR in Chromium dedicated Worker');
  const start=performance.now();const p=await run({op:'prove',statement,witness});if(!p.ok)throw new Error('Proving failed');const proof=p.result;
  await window.progress('Browser proof complete; checking separate expected public inputs');
  const v=await run({op:'verify',statement,proof});
  const root=structuredClone(statement);root.root[0]^=1;const vr=await run({op:'verify',statement:root,proof});
  const nul=structuredClone(statement);nul.nullifier[0]^=1;const vn=await run({op:'verify',statement:nul,proof});
  const context=structuredClone(statement);context.context[0]^=1;const vctx=await run({op:'verify',statement:context,proof});
  const corrupted=proof.slice();corrupted[0]^=1;const vc=await run({op:'verify',statement,proof:corrupted});
  const invalid=structuredClone(witness);invalid.secret[0]^=1;const vi=await run({op:'prove',statement,witness:invalid});
  const malformed=structuredClone(witness);malformed.directions[0]=2;const vm=await run({op:'prove',statement,witness:malformed});
  const trailing=new Uint8Array(proof.length+1);trailing.set(proof);const vt=await run({op:'verify',statement,proof:trailing});
  if(exportPublic){let binary='';for(let at=0;at<proof.length;at+=32768)binary+=String.fromCharCode(...proof.subarray(at,at+32768));await window.capturePublicProof({proofB64:btoa(binary),statement});}
  return {proofBytes:proof.length,proveMs:p.elapsedMs,proveLinearMemoryBytes:p.linearMemoryBytes,verifyMs:v.elapsedMs,verifyLinearMemoryBytes:v.linearMemoryBytes,totalMs:performance.now()-start,publicVkPostcardHex:profile.result,checks:{valid:v.ok&&v.result===true,changedRoot:vr.ok&&vr.result===false,changedNullifier:vn.ok&&vn.result===false,changedContext:vctx.ok&&vctx.result===false,corruptedProof:!vc.ok||vc.result===false,changedSecret:!vi.ok,nonBooleanDirection:!vm.ok,trailingBytes:!vt.ok},witnessExported:false,proofExported:exportPublic,workersTerminatedAfterEveryOperation:true};
 },exportPublic));
 report.success=Object.values(report.checks).every(Boolean)&&report.externalRequests.length===0&&report.consoleEntries.length===0&&report.errors.length===0;
}catch(e){report.success=false;report.failure=String(e.message).slice(0,180);}
finally{writeFileSync(join(root,'browser-v5-report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();server.close();}
process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.success)process.exitCode=1;
