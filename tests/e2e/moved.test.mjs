// Old address (/formation-studio/, before the repo rename): a browser tab goes on to /lineup/ keeping the link;
// a web app installed from there keeps its projects and explains how to bring them to the new address.
import { expect, launch, runner, watch } from './browser.mjs';

const SP = process.env.SP;
const HOST = 'http://127.0.0.1:8811';
const { step, finish, errors, log } = runner();
const browser = await launch();

async function context(installed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((installed) => {
    localStorage.setItem('fs-tour-done', '1');
    localStorage.setItem('fs-coach-off', '1');
    if (installed) Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
  }, installed);
  const page = await ctx.newPage();
  watch(page, installed ? 'installed' : 'tab', errors);
  return { ctx, page };
}

await step('browser tab: goes to the new address, link kept', async () => {
  const { ctx, page } = await context(false);
  await page.goto(`${HOST}/formation-studio/#/guide`);
  await page.waitForURL(`${HOST}/lineup/#/guide`, { timeout: 10000 });
  await page.waitForSelector('.lib-top');
  await ctx.close();
});

await step('installed app without projects: goes too', async () => {
  const { ctx, page } = await context(true);
  await page.goto(`${HOST}/formation-studio/`);
  await page.waitForURL(`${HOST}/lineup/`, { timeout: 10000 });
  await ctx.close();
});

await step('installed app with projects: stays, saves them, both offline copies kept', async () => {
  const { ctx, page } = await context(true);
  // a project first (same browser storage here), otherwise the old address has nothing to keep and moves on
  await page.goto(`${HOST}/lineup/`);
  await page.waitForSelector('.lib-top');
  await page.click('.new-btn');
  await page.click('.flow-foot .btn.primary');
  await page.click('.flow-foot .btn.primary');
  await page.click('.flow-foot .btn.ghost:has-text("Plus tard")');
  await page.fill('.flow-input', 'Projet de l’ancienne app');
  await page.click('.flow-foot .btn.primary');
  await page.waitForSelector('g.dancer');
  await page.goto(`${HOST}/formation-studio/`);
  await page.waitForSelector('text=/changé d.adresse/', { timeout: 5000 });
  expect(page.url().startsWith(`${HOST}/formation-studio/`), `left the old address: ${page.url()}`);
  await page.screenshot({ path: `${SP}/moved-dialog.png` });
  const [file] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Enregistrer mes projets")')]);
  expect(/sauvegarde/.test(file.suggestedFilename()), `file ${file.suggestedFilename()}`);
  await page.waitForSelector('button:has-text("Enregistré")');
  await page.click('.btn.ghost:has-text("Plus tard")');
  await page.waitForSelector('.moved-pill');
  await page.screenshot({ path: `${SP}/moved-pill.png` });

  await page.evaluate(() => navigator.serviceWorker.ready);
  const other = await ctx.newPage();
  await other.goto(`${HOST}/lineup/`);
  await other.evaluate(() => navigator.serviceWorker.ready);
  await other.waitForTimeout(1500);
  const keys = await other.evaluate(() => caches.keys());
  log('caches', keys.join(' · '));
  expect(keys.some((k) => k.startsWith('lineup:/lineup/:')) && keys.some((k) => k.startsWith('lineup:/formation-studio/:')), 'one address deleted the other’s offline copy');
  await ctx.close();
});

await browser.close();
finish();
