// Real Chromium WebAuthn/PRF, encrypted backup, app UI and browser Groth16.
// Chain reads use an explicitly injected direct test transport, not Nym.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const base=process.env.QRAFT_PRIVATE_TEST_URL??'http://localhost:3108';
const manifest=JSON.parse(await readFile('public/private-deployment.json','utf8'));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
await mkdir('.local/private-browser',{recursive:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await context.exposeBinding('testPrivateRpc',async(_,method,params=[])=>{const r=await fetch(manifest.sidecarUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;});
 await context.addInitScript(()=>{let firstRead=true;window.testReconnects=0;const status={phase:'ready',network:'test',detail:null,code:null,lastLatencyMs:0,requestCount:0};window.__qraftPageConnection={transport:{start(){},stop(){window.testReconnects++;},getStatus(){return status;},subscribe(fn){fn(status);return()=>{};},request(method,params){if(firstRead){firstRead=false;return Promise.reject(new Error('Network read timed out'));}return window.testPrivateRpc(method,params);}}};});
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
 await page.goto(base+'/app');await page.getByRole('button',{name:'Create private wallet',exact:true}).click();
 await page.getByRole('dialog',{name:'Your recovery file',exact:true}).waitFor({timeout:30000});
 await page.getByLabel('Recovery password',{exact:true}).fill('qraft-browser-test-password');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted recovery file',exact:true}).click();const file=await download;await file.saveAs('.local/private-browser/recovery.json');
 await page.getByRole('button',{name:'I saved the file and password',exact:true}).click();
 await page.getByText('Balance up to date',{exact:true}).waitFor({timeout:45000});
 await page.getByRole('button',{name:'Receive',exact:true}).click();const address=await page.getByLabel('Private receiving address',{exact:true}).inputValue();assert.ok(address.startsWith('qraft1.'));
 await page.keyboard.press('Escape');await page.screenshot({path:'.local/private-browser/wallet-desktop.png',fullPage:true});
 const saved=JSON.parse(await page.evaluate(()=>localStorage.getItem('qraft:private:wallets:v1')));assert.equal(saved[0].backedUp,true);assert.ok(saved[0].vault.ciphertext);assert.equal(saved[0].vault.master,undefined);
 await page.reload();await page.getByRole('button',{name:'Unlock your wallet',exact:true}).click();await page.getByRole('button',{name:/Wallet 1 Recovery file saved/}).click();await page.getByText('Balance up to date',{exact:true}).waitFor({timeout:45000});
 await page.getByRole('button',{name:'Receive',exact:true}).click();assert.equal(await page.getByLabel('Private receiving address',{exact:true}).inputValue(),address);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/private-browser/wallet-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Real Web Locks prevent a second tab's intent before any proving/signing.
 const journal='qraft:private:intent:v1:'+manifest.contracts.pool.address+':'+saved[0].vault.owner;
 await page.evaluate(key=>{window.heldWalletLock=navigator.locks.request(key,()=>new Promise(resolve=>{window.releaseWalletLock=resolve;}));},journal);
 await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByLabel('Amount in ETH',{exact:true}).fill('0.1');await page.getByLabel('Private receiving address',{exact:true}).fill(address);await page.getByRole('button',{name:'Review payment',exact:true}).click();await page.getByRole('button',{name:'Send privately',exact:true}).click();await page.getByRole('alert').filter({hasText:'another tab'}).first().waitFor();await page.evaluate(()=>window.releaseWalletLock());await page.keyboard.press('Escape');
 // Restore over an existing inaccessible vault, including an old journal that
 // cannot be decrypted with the newly created passkey.
 await page.evaluate(key=>localStorage.setItem(key,'old-passkey-encrypted-journal'),journal);
 await page.getByRole('button',{name:'Lock wallet',exact:true}).click();await page.getByRole('button',{name:'Restore wallet ↗',exact:true}).click();await page.locator('input[type=file]').setInputFiles('.local/private-browser/recovery.json');await page.getByLabel('Recovery password',{exact:true}).fill('qraft-browser-test-password');await page.getByRole('button',{name:'Restore wallet',exact:true}).click();await page.getByText('Balance up to date',{exact:true}).waitFor({timeout:45000});
 const replacement=JSON.parse(await page.evaluate(()=>localStorage.getItem('qraft:private:wallets:v1')));assert.equal(replacement.length,1);assert.notEqual(replacement[0].vault.metadata.credentialId,saved[0].vault.metadata.credentialId);assert.equal(await page.evaluate(key=>localStorage.getItem(key),journal),null);assert.equal(await page.getByRole('button',{name:'Withdraw',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Receive',exact:true}).click();assert.equal(await page.getByLabel('Private receiving address',{exact:true}).inputValue(),address);await page.keyboard.press('Escape');
 // Bundle the actual browser prover and protocol builder, then exercise the
 // shipped worker using its pinned WASM/zkey, rather than a mock proof.
 await writeFile('.local/private-browser/proof-entry.ts',`import {derivePrivateKeys,PrivateTree,buildPrivateAction,decodePrivateAddress,encodePrivateAddress} from '../../src/lib/private-wallet/protocol';import {provePrivate} from '../../src/lib/private-wallet/prover';window.testProof=async(domain)=>{const keys=derivePrivateKeys(new Uint8Array(32).fill(99));const built=await buildPrivateAction({domain,keys,tree:new PrivateTree(),inputs:[],outputs:[{recipient:decodePrivateAddress(encodePrivateAddress(domain,keys),domain),amount:100n}],kind:0,deposit:100n,expiry:100n});const start=performance.now();const proof=await provePrivate(built.witness,built.signals,()=>{});return{words:proof.length,ms:Math.round(performance.now()-start)};};`);
 execFileSync('bun',['build','.local/private-browser/proof-entry.ts','--target=browser','--outfile=.local/private-browser/proof-entry.js']);
 await page.addScriptTag({content:await readFile('.local/private-browser/proof-entry.js','utf8')});
 const proof=await page.evaluate(domain=>window.testProof(domain),{chainId:manifest.chainId,genesisHash:manifest.genesisHash,pool:manifest.contracts.pool.address});assert.equal(proof.words,8);
 assert.equal(await page.evaluate(()=>window.testReconnects),1);assert.deepEqual(errors,[]);const result={passed:true,transport:'injected direct test RPC; does not validate Nym',timedOutReadReconnect:true,passkey:true,encryptedBackup:true,reloadUnlock:true,receivingAddressStable:true,crossTabLock:true,lostPasskeyReplacement:true,oldJournalArchived:true,recoveryQuarantine:true,mobileOverflow:false,browserProof:proof};await writeFile('docs/pq/private-wallet-browser.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{await browser.close();}
