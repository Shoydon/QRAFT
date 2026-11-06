/** Real browser lifecycle: real WebAuthn PRF, real Nym and real sidecar transactions. */
import assert from 'node:assert/strict';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const manifest=JSON.parse(await readFile('public/modular-deployment.json','utf8'));
const wallets=await Promise.all([1,2].map(i=>readFile(`.local/modular-live/wallet-${i}.json`,'utf8').then(JSON.parse)));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:950}});const page=await context.newPage();page.setDefaultTimeout(120000);
const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
let assertions=0,directRpc=0,secretRequests=0;const needles=wallets.map(w=>w.seed);const errors=[];cdp.on('WebAuthn.credentialAsserted',()=>assertions++);
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/altmempool.*forshtat/.test(r.url()))directRpc++;const data=r.postData()??'';if(needles.some(s=>data.includes(s)||data.includes(s.slice(2))))secretRequests++;});
const log=setInterval(()=>page.locator('main').innerText().then(t=>console.log(t.replace(/\s+/g,' ').slice(-1300))).catch(()=>{}),30000);
const rpc=async(method,params=[])=>{const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;};
try{
 await page.goto('http://localhost:3028/app');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 for(let i=0;i<2;i++){await page.locator('dialog[open] input[type=file]').setInputFiles(`.local/modular-live/wallet-${i+1}.json`);await page.getByText(`${i+1} ${i?'wallets':'wallet'} found`,{exact:true}).waitFor();}
 await page.getByRole('textbox',{name:'Wallet 1 name',exact:true}).fill('Deposits');await page.getByRole('textbox',{name:'Wallet 2 name',exact:true}).fill('Withdrawals');
 await page.getByRole('button',{name:'Unlock',exact:true}).first().click();await page.getByRole('button',{name:'Deposits',exact:true}).waitFor();
 await page.getByText('Chain 1337 · Nym ready',{exact:true}).waitFor({timeout:300000});
 const beforeAssertions=assertions;await page.reload();await page.getByRole('button',{name:'Connect wallet',exact:true}).waitFor();await page.waitForTimeout(1000);assert.equal(assertions,beforeAssertions,'Reload must not unlock');
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Unlock',exact:true}).first().click();await page.getByRole('button',{name:'Deposits',exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Save your private note',exact:true}).click();const file=await download;await file.saveAs('.local/modular-live/browser-note.json');await chmod('.local/modular-live/browser-note.json',0o600);const noteText=await readFile('.local/modular-live/browser-note.json','utf8'),note=JSON.parse(noteText);needles.push(note.nullifier,note.secret);
 const walletBefore=BigInt(await rpc('eth_getBalance',[wallets[0].address,'latest']));
 await page.getByRole('button',{name:'Deposit 0.0001 ETH',exact:true}).click();await page.getByRole('dialog').filter({visible:true}).getByText('Confirmed',{exact:true}).waitFor({timeout:360000});
 const depositHash=(await page.locator('dialog[open] a').getAttribute('href')).split('/tx/')[1];
 const deposit=await rpc('eth_getTransactionReceipt',[depositHash]);assert.equal(deposit.payer.toLowerCase(),manifest.contracts.paymaster.address.toLowerCase());assert(deposit.frameReceipts.every(f=>f.status==='0x1'));assert.equal(walletBefore-BigInt(await rpc('eth_getBalance',[wallets[0].address,'latest'])),BigInt(manifest.denominationWei));
 await page.locator('dialog[open]').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Deposits',exact:true}).click();await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Withdrawals',exact:true}).waitFor();
 await page.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByRole('textbox',{name:'Private note',exact:true}).fill(noteText);await page.getByRole('textbox',{name:'Recipient address',exact:true}).fill(wallets[1].address);
 const before=BigInt(await rpc('eth_getBalance',[wallets[1].address,'latest']));const start=Date.now();await page.getByRole('button',{name:'Withdraw 0.0001 ETH',exact:true}).click();await page.locator('dialog[open]').getByText('Confirmed',{exact:true}).waitFor({timeout:360000});
 const withdrawalHash=(await page.locator('dialog[open] a').getAttribute('href')).split('/tx/')[1];const withdrawal=await rpc('eth_getTransactionReceipt',[withdrawalHash]);assert(withdrawal.frameReceipts.every(f=>f.status==='0x1'));assert.equal(withdrawal.payer.toLowerCase(),manifest.contracts.paymaster.address.toLowerCase());assert.equal(BigInt(await rpc('eth_getBalance',[wallets[1].address,'latest']))-before,BigInt(manifest.denominationWei));
 assert.equal(directRpc,0);assert.equal(secretRequests,0);assert.deepEqual(errors,[]);
 await page.screenshot({path:'.local/modular-live/browser-receipt.png',fullPage:true});await context.storageState({path:'.local/modular-live/browser-state.json'});await chmod('.local/modular-live/browser-state.json',0o600);
 const evidence={passed:true,chainId:1337,transport:'real Nym Anon-RPC',passkeys:'real Chromium WebAuthn PRF with virtual authenticator',reloadDoesNotUnlock:true,directBrowserRpcPosts:directRpc,secretRequests,deposit,withdrawal,withdrawalWallMs:Date.now()-start};await writeFile('docs/pq/modular-browser.json',JSON.stringify(evidence,null,2)+'\n');console.log('REAL BROWSER END-TO-END PASSED',depositHash,withdrawalHash);
}finally{clearInterval(log);await browser.close();}
