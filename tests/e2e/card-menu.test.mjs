// Project card "⋯" button: size on computer and phone, opens its menu, card not opened by the tap.
import { chromium } from 'playwright-core';
const SP = process.env.SP;
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: exe });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failed = 0;
for (const [name, opts] of [
  ['computer', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, userAgent: IPHONE }],
]) {
  const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('fs-tour-done', '1');
    localStorage.setItem('fs-coach-off', '1');
  });
  const page = await ctx.newPage();
  const touch = !!opts.hasTouch;
  const tap = (sel) => (touch ? page.tap(sel) : page.click(sel));
  await page.goto('http://127.0.0.1:8811/formation-studio/');
  await page.waitForSelector('.lib-top');
  await tap(touch ? '.fab' : '.new-btn');
  await tap('.flow-foot .btn.primary');
  await tap('.flow-foot .btn.primary');
  await tap('.flow-foot .btn.ghost:has-text("Plus tard")');
  await page.fill('.flow-input', 'Cover avec un nom assez long pour la carte');
  await tap('.flow-foot .btn.primary');
  await page.waitForSelector('g.dancer');
  await page.goto('http://127.0.0.1:8811/formation-studio/');
  await page.waitForSelector('.card-menu-btn');
  const box = await page.$eval('.card-menu-btn', (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  await page.screenshot({ path: `${SP}/card-menu-${name}.png` });
  await tap('.card-menu-btn');
  const opened = await page.waitForSelector('.menu.floating', { timeout: 3000 }).then(() => true).catch(() => false);
  const stillLibrary = !!(await page.$('.lib-top'));
  await page.screenshot({ path: `${SP}/card-menu-${name}-open.png` });
  const ok = box.w >= (touch ? 44 : 36) && box.h >= (touch ? 44 : 36) && opened && stillLibrary;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}: button ${box.w}×${box.h} px · menu opens ${opened} · stays on the library ${stillLibrary}`);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
