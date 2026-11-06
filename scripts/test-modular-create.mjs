import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext();const page=await context.newPage();
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
 await page.goto('http://localhost:3028/app');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/atomic/wallet')&&r.request().method()==='POST',{timeout:300000});
 await page.getByRole('button',{name:'Create ERC-8286 wallet',exact:true}).click();
 const result=await response;const data=await result.json();assert.equal(result.status(),200,JSON.stringify(data));
 await page.getByText('ERC-8286 wallet deployed',{exact:true}).waitFor({timeout:30000});
 assert.match(data.address,/^0x[0-9a-fA-F]{40}$/);assert.match(data.hash,/^0x[0-9a-fA-F]{64}$/);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('qraft:atomic:wallets:v1')??'[]'));assert.equal(saved.length,1);assert.equal(saved[0].vault.address,data.address);assert.equal(JSON.stringify(saved).includes('"seed"'),false);
 await context.storageState({path:'.local/modular-live/created-browser-state.json'});
 const {chmod}=await import('node:fs/promises');await chmod('.local/modular-live/created-browser-state.json',0o600);
 await writeFile('docs/pq/modular-creation.json',JSON.stringify({passed:true,chainId:1337,address:data.address,transactionHash:data.hash,passkeyProtected:true,creationLabel:'ERC-8286 wallet'},null,2)+'\n');console.log('BROWSER WALLET CREATION PASSED',data.address,data.hash);
}finally{await browser.close();}
