/** Full UI-to-chain flow. Direct test reads; real native sidecar submissions,
 * browser-only provisioning and submission, real passkeys, browser proofs and live ETH. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
const base=process.env.QRAFT_PRIVATE_TEST_URL??'http://localhost:3108';
const manifest=JSON.parse(await readFile('public/private-deployment.json','utf8'));
const realNym=process.env.QRAFT_PRIVATE_REAL_NYM==='1';
const root='.local/private-e2e';await mkdir(root,{recursive:true,mode:0o700});
const browser=await chromium.launch({headless:true}),events=[],contexts=[];
async function rpc(method,params=[]){const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}
async function device(waitForNetwork=true){
 const context=await browser.newContext({acceptDownloads:true});contexts.push(context);
 if(!realNym)await context.exposeBinding('testPrivateRpc',(_,method,params)=>rpc(method,params));
 if(!realNym)await context.addInitScript(()=>{const status={phase:'ready',network:'test',detail:null,code:null,lastLatencyMs:0,requestCount:0};window.__qraftPageConnection={transport:{start(){},stop(){},getStatus(){return status;},subscribe(fn){fn(status);return()=>{};},request(method,params){return window.testPrivateRpc(method,params);}}};});
 const page=await context.newPage();page.setDefaultTimeout(realNym?300000:45000);const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
 await page.route('**/api/private/relay',()=>{throw Error('Backend payment relay must never be used');});await page.route('**/api/atomic/wallet',()=>{throw Error('Backend provisioning must never be used');});await page.goto(base+'/app');if(realNym&&waitForNetwork)await page.getByText('Nym connected',{exact:true}).waitFor({timeout:300000});return{context,page};
}
async function create(page,name,offline=false){
 await page.getByRole('button',{name:'Create ERC-8286 PQ wallet',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted recovery file',exact:true}).click();await(await download).saveAs(root+'/'+name+'-recovery.json');await page.getByRole('button',{name:'I saved the file',exact:true}).click();if(!offline)await waitSync(page);events.push(name+' created'+(offline?' offline':'')+', encrypted recovery verified');
}
async function receiving(page){await page.getByRole('button',{name:'Receive',exact:true}).click();const value=await page.getByLabel('Private receiving address',{exact:true}).inputValue();await page.keyboard.press('Escape');return value;}
async function settle(page,label){
 const deadline=Date.now()+(realNym?600000:330000);
 while(Date.now()<deadline){
  if(await page.getByText('Payment confirmed',{exact:true}).first().isVisible().catch(()=>false)){events.push(label+' confirmed');console.log(label,'confirmed');return;}
  const busy=await page.locator('main[aria-busy="true"]').count();
  if(!busy){
   if(await page.getByRole('dialog').isVisible().catch(()=>false))await page.keyboard.press('Escape');
   const check=page.getByRole('button',{name:'Check payment',exact:true});
   if(await check.isVisible()){
    const errors=await page.getByRole('alert').allTextContents();if(errors.some(e=>/Invalid payment|shouldn't be a contract|permissions|different pool/i.test(e)))throw Error(label+': '+errors.join(' | '));
    await check.click();
   }else{const error=await page.getByRole('alert').allTextContents();throw Error(label+': '+error.join(' | '));}
  }
  await page.waitForTimeout(2000);
 }
 throw Error(label+' did not confirm: '+(await page.getByRole('alert').allTextContents()).join(' | '));
}
async function payment(page,kind,amount,recipient){
 await page.getByRole('button',{name:kind,exact:true}).click();await page.getByLabel('Amount in ETH',{exact:true}).fill(amount);
 if(recipient)await page.getByLabel(kind==='Send'?'Private receiving address':'Public Ethereum address',{exact:true}).fill(recipient);
 await page.getByRole('button',{name:kind==='Add ETH'?'Review deposit':'Review payment',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:kind==='Send'?'Send privately':kind==='Withdraw'?'Withdraw ETH':'Add ETH',exact:true}).click();
 await settle(page,kind+' '+amount);
}
async function waitSync(page){const deadline=Date.now()+(realNym?600000:60000);let reconnects=0;while(Date.now()<deadline){if(await page.getByText('Balance up to date',{exact:true}).isVisible().catch(()=>false))return;const errors=await page.getByRole('alert').allTextContents();if(errors.some(e=>/timed out|timeout|network|fetch/i.test(e))&&!await page.locator('button[aria-busy=\"true\"]').count()){if(++reconnects>3)throw Error('Nym did not recover after three reconnects');events.push('Nym read reconnected');console.log('Reconnecting an interrupted Nym read');await page.getByRole('button',{name:'Reconnect network',exact:true}).click();await page.waitForTimeout(1500);}await page.waitForTimeout(2000);}throw Error('Balance sync did not complete');}
async function refresh(page){await page.getByRole('button',{name:'Refresh ↻',exact:true}).click();await waitSync(page);}
try{
 const alice=await device(),bob=await device(false);await create(alice.page,'alice');await bob.page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Create ERC-8286 PQ wallet'&&!b.disabled));await bob.context.setOffline(true);await create(bob.page,'bob',true);const bobAddress=await receiving(bob.page);events.push('Bob offline');
 await alice.page.getByRole('button',{name:'Manage ERC-8286 PQ wallets',exact:true}).click();const publicAddress=await alice.page.getByLabel('ERC-8286 PQ wallet address',{exact:true}).inputValue();await alice.page.keyboard.press('Escape');
 await new Promise((resolve,reject)=>{const child=spawn('bun',['scripts/fund-private-test-address.ts',publicAddress],{stdio:'inherit'});child.on('close',code=>code===0?resolve():reject(Error('Test funding failed')));child.on('error',reject);});
 await refresh(alice.page);await payment(alice.page,'Add ETH','0.00002');await refresh(alice.page);await payment(alice.page,'Add ETH','0.00002');await refresh(alice.page);
 await alice.page.getByText('0.00004',{exact:true}).waitFor();events.push('Two deposits displayed as one 0.00004 ETH balance');
 // Lose the actual node acknowledgement, then reconcile the exact local raw transaction.
 await alice.page.evaluate((sender)=>{
  window.__lostDirectResponse=false;const transport=window.__qraftPageConnection.transport;const original=transport.request.bind(transport);
  transport.request=async(method,params)=>{const result=await original(method,params);if(method==='eth_sendFrameTransaction'&&params[0].sender.toLowerCase()===sender.toLowerCase()&&!window.__lostDirectResponse){window.__lostDirectResponse=true;throw Error('Test lost submission acknowledgement');}return result;};
 },manifest.contracts.proofAccount.address);
 await alice.page.getByRole('button',{name:'Send',exact:true}).click();await alice.page.getByLabel('Amount in ETH',{exact:true}).fill('0.00003');await alice.page.getByLabel('Private receiving address',{exact:true}).fill(bobAddress);await alice.page.getByRole('button',{name:'Review payment',exact:true}).click();await alice.page.getByRole('button',{name:'Send privately',exact:true}).click();
 await alice.page.locator('main[aria-busy="true"]').first().waitFor({state:'hidden',timeout:260000});assert.equal(await alice.page.evaluate(()=>window.__lostDirectResponse),true);
 await alice.page.reload();await alice.page.getByRole('button',{name:'Unlock your ERC-8286 PQ wallet',exact:true}).click();await alice.page.getByRole('button',{name:/ERC-8286 PQ wallet 1 Recovery file saved/}).click();await alice.page.getByRole('button',{name:'Check payment',exact:true}).waitFor();await settle(alice.page,'Private payment after lost response/reload');
 await refresh(alice.page);await alice.page.getByText('0.00001',{exact:true}).waitFor();events.push('Sender change is exactly 0.00001 ETH');
 await bob.context.setOffline(false);await bob.page.evaluate(()=>localStorage.clear());await bob.page.reload();const restored=bob;await restored.page.getByRole('button',{name:'Restore ERC-8286 PQ wallet ↗',exact:true}).click();await restored.page.locator('input[type=file]').setInputFiles(root+'/bob-recovery.json');await restored.page.getByRole('button',{name:'Restore ERC-8286 PQ wallet',exact:true}).click();await restored.page.getByText('0.00003',{exact:true}).waitFor();assert.equal(await receiving(restored.page),bobAddress);events.push('Cleared browser storage restores payment and receiving identity using original passkey');
 console.log('Recovery safety timer running; waiting for onchain expiry window.');
 await restored.page.getByRole('button',{name:'Withdraw',exact:true}).waitFor();
 const deadline=Date.now()+360000;while(await restored.page.getByRole('button',{name:'Withdraw',exact:true}).isDisabled()){if(Date.now()>deadline)throw Error('Recovery never unlocked');await restored.page.waitForTimeout(15000);await refresh(restored.page);}
 const recipient='0x0000000000000000000000000000000000001234',before=BigInt(await rpc('eth_getBalance',[recipient,'latest']));
 await payment(restored.page,'Withdraw','0.00001',recipient);await refresh(restored.page);await restored.page.getByText('0.00002',{exact:true}).waitFor();assert.equal(BigInt(await rpc('eth_getBalance',[recipient,'latest']))-before,10000000000000n);
 const result={passed:true,pool:manifest.contracts.pool.address,transport:realNym?'Real Nym reads, browser-only account setup and all native payment submissions; no application relayer':'Injected direct RPC test transport; browser-only account setup and native payment submissions; no application relayer',events,withdrawalWei:'10000000000000',receiverRemainingEth:'0.00002'};await writeFile(realNym?'docs/pq/private-wallet-e2e-nym.json':'docs/pq/private-wallet-e2e.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}catch(error){await writeFile(root+'/failure.json',JSON.stringify({error:String(error),events},null,2));for(const [i,c] of contexts.entries())for(const p of c.pages())await p.screenshot({path:root+'/failure-'+i+'.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();}
