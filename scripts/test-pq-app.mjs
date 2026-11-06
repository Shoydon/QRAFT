/** Real local browser lifecycle. Keys/notes remain test-device files; output is public evidence only. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,chmod}from'node:fs/promises';
import {chromium}from'@playwright/test';
import{createPublicClient,http}from'viem';import{generatePrivateKey,privateKeyToAccount}from'viem/accounts';
const url=new URL(process.env.QRAFT_BROWSER_URL??'http://127.0.0.1:3006').origin;
const manifest=JSON.parse(await readFile('public/pq-deployment.json'));
if(!manifest.applicationEnabled)throw Error('Deploy the QRAFT protocol and update its verified deployment manifest before running the live lifecycle test.');
const rpc=createPublicClient({cacheTime:0,transport:http(manifest.rpcUrl,{timeout:60000,retryCount:0})});
const browser=await chromium.launch({headless:true});await mkdir('.local',{recursive:true});
const sponsorBefore=await rpc.getBalance({address:manifest.contracts.paymaster.address});
const stamp=Date.now();const restore=process.env.QRAFT_TEST_WALLET;const walletPath=restore??`.local/pq-app-wallet-${stamp}.json`;const notePath=process.env.QRAFT_TEST_NOTE??`.local/pq-app-note-${stamp}.txt`;if(restore&&!process.env.QRAFT_TEST_NOTE)throw Error('Restoring the test requires both saved backups.');
const resumeJobId=process.env.QRAFT_TEST_JOB;
if(resumeJobId&&(!restore||!/^([a-f0-9]{64})$/.test(resumeJobId)))throw Error('Public job recovery requires saved backups and a valid job ID.');
let wallet;let depositHash=null;let depositAccountBalanceBefore=null;let depositAccountBalanceAfter=null;
const errors=[];let directBrowserPosts=0;let sensitiveRequests=0;const needles=[];const requests=[];
let context,page;let latestProgress='';
const diagnostic=setInterval(()=>{if(page&&!page.isClosed())void page.locator('main').allTextContents().then(text=>console.log('Browser state:',text.join(' ').replace(/\s+/g,' ').slice(-1300))).catch(()=>{});},30000);
async function newPage(){
 context=await browser.newContext({acceptDownloads:true,permissions:['clipboard-read','clipboard-write'],viewport:{width:1280,height:900}});page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const body=request.postDataBuffer();if(request.method()==='POST'&&request.url().startsWith(manifest.rpcUrl))directBrowserPosts++;if(body){requests.push(body);if(needles.some(needle=>body.includes(needle)))sensitiveRequests++;}});
 page.on('response',response=>{if(response.request().method()==='GET'&&/\/api\/pq\/proofs\/[a-f0-9]{64}$/.test(response.url()))void response.json().then(job=>{const label=job.phase==='verifying'?`${job.phase}:${Math.floor((job.done??0)/24)*24}`:job.stage;if(label&&label!==latestProgress){latestProgress=label;console.log(`PQ progress: ${label}`);}}).catch(()=>{});});
 await page.goto(new URL('/app',url).href);return page;
}
async function download(button,path){const waiting=page.waitForEvent('download');await button.click();await(await waiting).saveAs(path);await chmod(path,0o600);}
async function confirmed(timeout=300000){const receipt=page.getByText(/Confirmed in block/).filter({visible:true}).first();const stopped=page.getByText(/^(Withdrawal stopped|Deposit did not complete|Withdrawal outcome unknown|Deposit outcome unknown)$/).filter({visible:true}).first();await receipt.or(stopped).first().waitFor({timeout});if(await stopped.isVisible())throw Error('Transaction workflow stopped: '+(await page.locator('main').innerText()).replace(/\s+/g,' ').slice(-1400));}
try{
 if(!restore){
 await newPage();
 assert.equal(await page.getByText(/simulated|Groth16|MetaMask/).count(),0);
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Create PQ wallet',exact:true}).click();
 const backup=page.getByRole('button',{name:'Download PQ wallet backup',exact:true});
 const creationError=page.getByRole('dialog',{name:'PQ wallet',exact:true}).getByRole('alert');
 await backup.or(creationError).first().waitFor({timeout:1000000});
 if(await creationError.isVisible())throw Error('Wallet creation stopped: '+await creationError.innerText());
 await download(page.getByRole('button',{name:'Download PQ wallet backup',exact:true}),walletPath);
 wallet=JSON.parse(await readFile(walletPath));
 for(const text of [wallet.seed,wallet.seed?.replace(/^0x/,'')])if(text)needles.push(Buffer.from(text));
 if(wallet.seed)needles.push(Buffer.from(wallet.seed.replace(/^0x/,''),'hex'));
 for(const body of requests)if(needles.some(needle=>body.includes(needle)))sensitiveRequests++;
 await page.getByRole('checkbox',{name:/I saved the wallet backup securely/}).check();
 await page.getByRole('button',{name:'I saved my PQ wallet backup',exact:true}).click();
 console.log('PASS fresh ML-DSA account provisioning, independent ownership checks and explicit wallet backup');
 await page.getByRole('button',{name:'Generate a PQ note',exact:true}).click();
 await page.getByRole('button',{name:'Copy note',exact:true}).click();
 await writeFile(notePath,await page.evaluate(()=>navigator.clipboard.readText()),{mode:0o600});
 const noteText=await readFile(notePath,'utf8');const noteFields=JSON.parse(noteText.slice('qraft-pq-note-v1:'.length,noteText.lastIndexOf(':')));
 const secret=noteFields[5];needles.push(Buffer.from(secret),Buffer.from(secret.slice(2)),Buffer.from(secret.slice(2),'hex'));
 await page.getByRole('checkbox',{name:/I saved this note file/}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 depositAccountBalanceBefore=await rpc.getBalance({address:wallet.address});
 await page.getByRole('button',{name:'Deposit 0.0001 ETH',exact:true}).click();
 await confirmed(360000);
 await page.getByRole('button',{name:'Copy hash',exact:true}).filter({visible:true}).click();
 depositHash=await page.evaluate(()=>navigator.clipboard.readText());
 const depositReceipt=await rpc.request({method:'eth_getTransactionReceipt',params:[depositHash]});
 assert.equal(depositReceipt.payer.toLowerCase(),manifest.contracts.paymaster.address.toLowerCase());
 assert.equal(depositReceipt.frameReceipts.length,3);assert(depositReceipt.frameReceipts.every(frame=>frame.status==='0x1'));
 depositAccountBalanceAfter=await rpc.getBalance({address:wallet.address});
 assert.equal(depositAccountBalanceBefore-depositAccountBalanceAfter,BigInt(manifest.denominationWei));
 console.log('PASS sponsored browser native-frame deposit: paymaster paid gas, account paid exact principal');
 }else{wallet=JSON.parse(await readFile(walletPath));const text=await readFile(notePath,'utf8');const note=JSON.parse(text.slice('qraft-pq-note-v1:'.length,text.lastIndexOf(':')));for(const secret of [wallet.seed,note[5]])if(secret)needles.push(Buffer.from(secret),Buffer.from(secret.replace(/^0x/,''),'hex'));}
 const poolAbi=JSON.parse(await readFile('public/pq-v5/abis.json')).pool;
 const poolBefore=await rpc.getBalance({address:manifest.pool});
 if(context)await context.close();
 await newPage();
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 for(let attempt=0;;attempt++){
  const sheet=page.getByRole('dialog',{name:'PQ wallet',exact:true});
  await page.getByLabel('PQ wallet backup',{exact:true}).setInputFiles(walletPath);
  const opened=await Promise.race([sheet.waitFor({state:'hidden',timeout:360000}).then(()=>true),sheet.getByRole('alert').waitFor({timeout:360000}).then(()=>false)]);
  if(opened)break;
  const message=await sheet.getByRole('alert').innerText();if(attempt>=2||!/timed out|timeout|network|fetch/i.test(message))throw Error('Wallet recovery stopped: '+message);
  console.log('Anonymous RPC timed out during public ownership checks; explicitly reconnecting Nym and retrying the same backup.');
  await sheet.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:/Ethrex devnet.*reads/}).click();
  const reads=page.getByRole('dialog',{name:'Read path and security scope',exact:true});await reads.getByRole('button',{name:'Reconnect anonymous reads',exact:true}).click();await reads.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 }
 let recovered;
 if(resumeJobId){
  const response=await fetch(`${url}/api/pq/proofs/${resumeJobId}`);if(!response.ok)throw Error('The saved public proof job is unavailable.');recovered=await response.json();
  if(!recovered.sessionId||!recovered.claimsBlob||!['verifying','verified'].includes(recovered.phase))throw Error('Only an attached, continuing public verification job can be recovered by this test.');
  const statement=recovered.statement;const recipient=statement.publicContext.recipientHex;const deadline=statement.publicContext.deadline;
  const flow={owner:wallet.address,binding:JSON.stringify([statement.root,statement.nullifier,statement.context,recipient,deadline]),nullifier:'0x'+Buffer.from(statement.nullifier).toString('hex'),recipient,deadline,sessionId:recovered.sessionId,attached:true};
  await page.evaluate(({key,flow})=>localStorage.setItem(key,JSON.stringify(flow)),{key:`qraft:pq:public-flow:v1:${resumeJobId}`,flow});
 }
 await page.getByRole('tab',{name:/^withdraw$/i}).click();
 await page.getByLabel('PQ note file',{exact:true}).setInputFiles(notePath);
 const recipient=recovered?.statement.publicContext.recipientHex??privateKeyToAccount(generatePrivateKey()).address;
 const recipientBefore=await rpc.getBalance({address:recipient});
 if(recovered){await page.getByRole('button',{name:'Resume the same withdrawal',exact:true}).waitFor({timeout:360000});}else{
 for(let attempt=0;;attempt++){
  const recipientInput=page.getByRole('textbox',{name:'Recipient address',exact:true});
  const retry=page.getByRole('button',{name:'Check again',exact:true});
  await recipientInput.or(retry).first().waitFor({timeout:360000});
  if(await recipientInput.isVisible())break;
  const message=await page.locator('#pq-panel-withdraw').innerText();
  if(attempt>=2||!/RPC.*(?:pool|snapshot|inconsistent)/.test(message))throw Error('Note check stopped: '+message.replace(/\s+/g,' ').slice(-800));
  console.log('Retrying an inconsistent anonymous RPC snapshot; no transaction was submitted.');await retry.click();
 }
 await page.getByRole('textbox',{name:'Recipient address',exact:true}).fill(recipient);
 await page.getByRole('button',{name:'Review withdrawal',exact:true}).click();
 await page.getByRole('button',{name:'Generate PQ proof and withdraw',exact:true}).click();
 }
 if(recovered)await page.getByRole('button',{name:'Resume the same withdrawal',exact:true}).click();
 console.log(recovered?'Resuming the same public verification session and final native withdrawal':'Running browser V5 proof, public encoding, native session authorization and staged EVM verification');
 await confirmed(3600000);
 const delta=(await rpc.getBalance({address:recipient}))-recipientBefore;
 assert.equal(delta,BigInt(manifest.denominationWei));
 assert.equal(await rpc.getBalance({address:manifest.pool}),poolBefore-BigInt(manifest.denominationWei));
 const contexts=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('qraft:pq:public-flow:')).map(key=>JSON.parse(localStorage.getItem(key))));
 const flow=contexts.find(flow=>flow.recipient?.toLowerCase()===recipient.toLowerCase());
 assert(flow?.result?.kind==='confirmed');
 const receipt=await rpc.request({method:'eth_getTransactionReceipt',params:[flow.result.hash]});
 assert.equal(receipt.type,'0x6');assert.equal(receipt.payer.toLowerCase(),manifest.contracts.paymaster.address.toLowerCase());assert.equal(receipt.frameReceipts.length,3);assert(receipt.frameReceipts.every(frame=>frame.status==='0x1'));
 const evidence={checkedAt:new Date().toISOString(),depositHash,depositAccountBalanceBeforeWei:depositAccountBalanceBefore===null?null:String(depositAccountBalanceBefore),depositAccountBalanceAfterWei:depositAccountBalanceAfter===null?null:String(depositAccountBalanceAfter),chainId:manifest.chainId,profile:manifest.profile,account:wallet.address,recipient,pool:manifest.pool,amountWei:manifest.denominationWei,recipientDeltaWei:String(delta),withdrawalHash:flow.result.hash,sessionId:flow.sessionId,resumedPublicJob:resumeJobId??null,directBrowserRpcPosts:directBrowserPosts,sensitiveHttpRequests:sensitiveRequests,browserErrors:errors,paymaster:manifest.contracts.paymaster.address,paymasterBalanceBeforeWei:String(sponsorBefore),paymasterBalanceAfterWei:String(await rpc.getBalance({address:manifest.contracts.paymaster.address})),nativeFrames:3,externalGasHelperRpc:'Direct RPC for public gas/proof computation; not anonymized',userAuthorization:'ML-DSA-44',noteHash:'SHA3-512',proof:'Transparent V5 hash/FRI'};
 assert.equal(directBrowserPosts,0);assert.equal(sensitiveRequests,0);assert.equal(errors.length,0,errors.join('\n'));
 await page.screenshot({path:'.local/pq-app-receipt.png',fullPage:true});
 await writeFile('.local/pq-app-evidence.json',JSON.stringify(evidence,null,2)+'\n');
 console.log('PASS exact native ETH payout after the complete PQ browser flow');
 await page.getByRole('button',{name:'Withdraw another note',exact:true}).click();
 await page.getByLabel('PQ note file',{exact:true}).setInputFiles(notePath);
 await page.getByText(/already been withdrawn|Already withdrawn|already spent/).first().waitFor({timeout:360000});
 console.log('PASS spent PQ note reimport');
 void poolAbi;
}catch(error){
 await context?.storageState({path:'.local/pq-app-public-browser-state.json'}).catch(()=>{});
 const alerts=await page?.getByRole('alert').allTextContents().catch(()=>[]);await page?.screenshot({path:'.local/pq-app-stopped.png',fullPage:true}).catch(()=>{});console.error('PQ browser test stopped:',error.message.split('\n')[0]);if(alerts?.length)console.error('Visible errors:',JSON.stringify(alerts));throw error;
}finally{clearInterval(diagnostic);await browser.close();}
