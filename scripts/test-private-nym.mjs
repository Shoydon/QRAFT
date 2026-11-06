// Real configured Nym worker: no injected transport and no direct read fallback.
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage();
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}});
 await page.goto(process.env.QRAFT_PRIVATE_TEST_URL??'http://localhost:3109/app');
 await page.getByText('Nym connected',{exact:true}).waitFor({timeout:250000});
 await page.getByRole('button',{name:'Create private wallet',exact:true}).click();
 await page.getByRole('dialog',{name:'Your recovery file',exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.getByText('Balance up to date',{exact:true}).waitFor({timeout:180000});
 const status=await page.evaluate(()=>window.__qraftPageConnection.transport.getStatus());
 if(status.phase!=='ready'||status.network!=='Nym')throw Error('Unexpected read transport');
 const result={passed:true,transport:status.network,requestCount:status.requestCount,scope:'Real Nym boot, chain/genesis and pool code verification, pool discovery and public balance read'};
 await writeFile('docs/pq/private-wallet-nym.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{await browser.close();}
