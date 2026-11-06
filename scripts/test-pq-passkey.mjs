/** Isolated browser custody test. The account adapter is simulated; WebAuthn/PRF/AES and reload are real Chromium APIs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const directory = '.local/passkey-test';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/entry.tsx`, `
import React, {useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {bytesToHex} from 'viem';
import {createKey} from '../../packages/pq-account/src/keys';
import {WalletPasskeyController} from '../../src/components/WalletPasskeyController';
import {WalletPicker} from '../../src/components/WalletPicker';
import {parseWalletSecrets} from '../../src/lib/pq/vault';
import manifest from '../../public/pq-deployment.json';
const transport = {};
function App(){
 const [account,setAccount]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef(null),busyRef=useRef(false);
 async function connect(file,options){
  const secrets=options.plaintextBackup?parseWalletSecrets(options.plaintextBackup):(()=>{
   const key=createKey(options.seed);key.seed.fill(0);
   return {version:1,algorithm:'ML-DSA-44',chainId:manifest.chainId,genesisHash:manifest.genesisHash,publicKey:bytesToHex(key.publicKey),address:'0x'+bytesToHex(key.publicKey).slice(-40),seed:bytesToHex(options.seed)};
  })();
  const client={address:secrets.address,publicKey:secrets.publicKey,backup:()=>JSON.stringify(secrets)};
  await options.onReady(client); pending.current?.fill(0);pending.current=null;setAccount(client);return client;
 }
 return <WalletPasskeyController account={account} transport={transport} getPendingSeed={()=>pending.current} setPendingSeed={seed=>{pending.current=seed;}}
 begin={()=>{if(busyRef.current)return false;busyRef.current=true;setBusy(true);return true;}} end={()=>{busyRef.current=false;setBusy(false);}}
 show={()=>{}} onSetupStart={()=>{window.setupStarts=(window.setupStarts??0)+1;}} error={setError} connect={connect} exportEncrypted={text=>{window.exportedVault=text;}} lock={()=>setAccount(null)} requireProtection={()=>{}}>
 {wallet=><><WalletPicker wallets={wallet.wallets} busy={busy} canCreate={true} select={wallet.selectWallet} rename={wallet.renameWallet} create={()=>wallet.createAnother()}/><button disabled={busy} onClick={()=>wallet.create()}>{wallet.primaryLabel}</button><button disabled={busy} onClick={wallet.lock}>Lock</button><button onClick={wallet.download}>Export</button><input type="file" onChange={e=>wallet.importFile(e.target.files[0])}/><output id="account">{account?.address||'locked'}</output><output id="error">{error}</output></>}
 </WalletPasskeyController>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`);
execFileSync('bun', ['build', `${directory}/entry.tsx`, '--target=browser', `--outfile=${directory}/bundle.js`], { stdio: 'pipe' });
const bundle = await readFile(`${directory}/bundle.js`);
const server = createServer((request, response) => {
  if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); }
  else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://${process.env.QRAFT_PASSKEY_TEST_HOST ?? 'localhost'}:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(); const page = await context.newPage();
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
  let assertions = 0; cdp.on('WebAuthn.credentialAsserted', () => assertions++);
  await page.goto(url); await page.getByRole('button', { name: 'Create PQ wallet', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked' || !!document.querySelector('#error').textContent, null, { timeout: 15000 });
  assert.notEqual(await page.locator('#account').textContent(), 'locked', await page.locator('#error').textContent());
  assert.equal(await page.evaluate(() => window.setupStarts), 1, 'New-wallet creation must open setup');
  const address = await page.locator('#account').textContent();
  const vaultText = await page.evaluate(() => localStorage.getItem('qraft:passkey-wallet:v1:1337'));
  const vault = JSON.parse(vaultText); assert.ok(vault.ciphertext); assert.equal(vault.seed, undefined); assert.equal(vault.address, address);
  const before = assertions; await page.reload();
  await page.getByRole('button', { name: 'Wallet found · Unlock with passkey', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#account').textContent(), 'locked');
  assert.equal(assertions, before, 'Reload must not request a passkey assertion');
  await page.getByRole('button', { name: 'Wallet found · Unlock with passkey', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked');
  assert.equal(await page.locator('#account').textContent(), address); assert.ok(assertions > before, 'Explicit unlock must request a fresh passkey assertion');
  assert.equal(await page.evaluate(() => window.setupStarts ?? 0), 0, 'Unlocking a deployed wallet must not start deployment');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  assert.equal(JSON.parse(await page.evaluate(() => window.exportedVault)).seed, undefined);
  // Reload stays locked; cancel an explicit unlock, then retry.
  await page.addInitScript(() => {
    const original = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = options => sessionStorage.getItem('cancel-passkey') === '1'
      ? Promise.reject(new DOMException('Canceled', 'NotAllowedError')) : original(options);
  });
  await page.evaluate(() => sessionStorage.setItem('cancel-passkey', '1')); await page.reload();
  await page.getByRole('button', { name: 'Wallet found · Unlock with passkey', exact: true }).click();
  await page.getByText('Passkey verification was not completed. Try again when you are ready.', { exact: true }).waitFor();
  assert.equal(await page.locator('#account').textContent(), 'locked');
  await page.evaluate(() => sessionStorage.removeItem('cancel-passkey'));
  await page.getByRole('button', { name: 'Wallet found · Unlock with passkey', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  assert.equal(await page.locator('#account').textContent(), 'locked');
  await page.getByRole('button', { name: 'Wallet found · Unlock with passkey', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked');
  // Imported encrypted backup still needs the matching passkey.
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'encrypted.json', mimeType: 'application/json', buffer: Buffer.from(vaultText) });
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked');
  await page.getByRole('button', { name: 'Create another wallet', exact: true }).click();
  await page.getByText('2 wallets found', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked');
  assert.notEqual(await page.locator('#account').textContent(), address, 'A second wallet must use a fresh keypair');
  const firstName = page.getByRole('textbox', { name: 'Wallet 1 name', exact: true });
  await firstName.fill('Deposits'); await firstName.press('Tab');
  await page.getByRole('button', { name: 'Select Deposits', exact: true }).waitFor();
  const secondName = page.getByRole('textbox', { name: 'Wallet 2 name', exact: true });
  assert.equal(await secondName.inputValue(), 'Wallet 2');
  await secondName.fill('Withdrawals'); await secondName.press('Tab');
  await page.getByRole('button', { name: 'Select Deposits', exact: true }).click();
  assert.equal(await page.locator('#account').textContent(), 'locked');
  await page.getByRole('button', { name: 'Wallet found · Unlock with passkey', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#account').textContent !== 'locked');
  assert.equal(await page.locator('#account').textContent(), address, 'Switching must restore the original wallet');
  const collection = JSON.parse(await page.evaluate(() => localStorage.getItem('qraft:wallets:v1:1337')));
  assert.deepEqual(collection.map(wallet => wallet.name), ['Deposits', 'Withdrawals']);
  assert.ok(collection.every(wallet => wallet.vault.ciphertext && wallet.vault.seed === undefined));
  const assertionsBeforeReload = assertions; await page.reload();
  await page.getByText('2 wallets found', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Wallet 1 name', exact: true }).inputValue(), 'Deposits');
  assert.equal(await page.getByRole('textbox', { name: 'Wallet 2 name', exact: true }).inputValue(), 'Withdrawals');
  assert.equal(await page.locator('#account').textContent(), 'locked');
  assert.equal(assertions, assertionsBeforeReload);
  await context.close();
  const unsupportedContext = await browser.newContext(); const unsupported = await unsupportedContext.newPage();
  const second = await unsupportedContext.newCDPSession(unsupported); await second.send('WebAuthn.enable');
  await second.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: false } });
  await unsupported.goto(url); await unsupported.getByRole('button', { name: 'Create PQ wallet', exact: true }).click();
  await unsupported.getByText('This passkey cannot encrypt wallets. Choose a passkey provider with WebAuthn PRF support.', { exact: true }).waitFor();
  assert.equal(await unsupported.locator('#account').textContent(), 'locked');
  assert.equal(await unsupported.evaluate(() => localStorage.length), 0);
  console.log('Passed: real WebAuthn PRF enrollment, encrypted storage/export/import, no passkey prompt on reload, explicit unlock, canceled unlock, retry, manual lock, multiple wallets, fresh keypairs, default names, rename persistence, wallet switching, unsupported PRF rejection. Account adapter simulated; no chain writes.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
