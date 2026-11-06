import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Controlled failures verify UI gating; this does not replace a live Nym test.
const origin = process.env.QRAFT_BROWSER_URL ?? 'http://127.0.0.1:3007';
const browser = await chromium.launch();
try {
  for (const helperEnabled of [true, false]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let provisioningPosts = 0;
    await page.route('**/api/pq/accounts', async route => {
      if (route.request().method() === 'POST') provisioningPosts++;
      await route.fulfill({ json: { enabled: helperEnabled } });
    });
    await page.route('https://ethereum-rpc.publicnode.com/**', route => route.fulfill({
      status: 503, body: 'Controlled bootstrap failure',
    }));
    await page.goto(`${origin}/app`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'PQ wallet', exact: true });
    const create = dialog.getByRole('button', { name: 'Create PQ wallet', exact: true });
    await dialog.getByText(helperEnabled ? /could not start/ : /local account service is unavailable/).waitFor();
    assert.equal(await create.isEnabled(), helperEnabled);
    assert.equal(await dialog.getByRole('button', { name: 'Import PQ wallet backup', exact: true }).isEnabled(), true);
    if (helperEnabled) {
      await create.click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /503|Bootstrap RPC/);
      assert.equal(await create.isEnabled(), true);
      await dialog.getByRole('button', { name: 'Retry anonymous connection', exact: true }).click();
      await dialog.getByText(/could not start/).waitFor();
    }
    assert.equal(provisioningPosts, 0, 'failed anonymous RPC must never provision or fund a wallet');
    await context.close();
  }
  console.log('PASS: visible connection failure/retry, no premature provisioning, backup import available without helper');
} finally {
  await browser.close();
}
