// Computer layout: resizable panels (kept after reload, double-click resets), video above the formations list,
// hint bubble and notifications not covered, small laptop width, phone and phone sideways unchanged.
import { chromium } from 'playwright-core';

const SP = process.env.SP;
const CLIP = `${SP}/detect/youdaone-480.mp4`;
const BASE = 'http://127.0.0.1:8811/formation-studio/';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ executablePath: exe });
const errors = [];
const log = (...a) => console.log('  •', ...a);
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    errors.push(`${name}: ${e.message.split('\n')[0]}`);
    console.log('✗', name, e.message.split('\n')[0]);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

async function editor(ctxOpts, tag, { video = true, coach = false } = {}) {
  const ctx = await browser.newContext({ ...ctxOpts, deviceScaleFactor: 2 });
  await ctx.addInitScript((coach) => {
    localStorage.setItem('fs-tour-done', '1');
    if (!coach) localStorage.setItem('fs-coach-off', '1');
  }, coach);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|XNNPACK/.test(m.text()) && errors.push(`[${tag}] ${m.text().slice(0, 200)}`));
  await page.goto(BASE);
  await page.waitForSelector('.lib-top');
  const touch = !!ctxOpts.hasTouch;
  const tap = (sel) => (touch ? page.tap(sel) : page.click(sel));
  await tap(touch ? '.fab' : '.new-btn');
  await page.fill('.flow-slider', '5');
  await tap('.flow-foot .btn.primary');
  await tap('.flow-foot .btn.primary');
  await tap('.flow-foot .btn.ghost:has-text("Plus tard")');
  await page.fill('.flow-input', `Panneaux ${tag}`);
  await tap('.flow-foot .btn.primary');
  await page.waitForSelector('g.dancer');
  if (video) {
    if (touch) {
      await tap('.toolbar button:has-text("Plus")');
      await tap('.more-row:has-text("Vidéo de référence")');
    } else await page.click('.topbar button:has-text("Vidéo")');
    await page.waitForSelector('.dropzone');
    await page.setInputFiles('.inspector input[type=file]', CLIP);
    await page.waitForSelector('.inspector .music-card', { timeout: 120000 });
    await page.waitForTimeout(800);
  }
  return { ctx, page, tap };
}
const rect = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; });
async function dragBy(page, sel, dx) {
  const h = await rect(page, sel);
  const x = h.x + h.w / 2;
  const y = h.y + h.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/* ------------------------------ computer ------------------------------ */
const desk = await editor({ viewport: { width: 1440, height: 900 } }, 'desktop', { coach: true });

await step('computer: video above the formations list, no empty space under it', async () => {
  const { page } = desk;
  expect(await page.$('.side-col > .ref-video.column'), 'video in the left column');
  expect(!(await page.$('.stage-wrap .ref-video')), 'no video over the stage');
  const video = await rect(desk.page, '.side-col > .ref-video.column');
  const list = await rect(desk.page, '.side-col > .formation-list');
  const col = await rect(desk.page, '.side-col');
  const stage = await rect(desk.page, '.stage-wrap');
  log('column', Math.round(col.w), '· video', Math.round(video.h), 'tall · list from', Math.round(list.y), 'to', Math.round(list.b), '· stage', Math.round(stage.w), 'wide');
  expect(near(list.y, video.b, 2), 'formations list starts right under the video');
  expect(near(list.b, col.b, 2), 'list fills the rest of the column');
  expect(stage.x >= col.r - 1, 'stage starts after the column');
  await page.screenshot({ path: `${SP}/panels-01-desktop.png` });
});

await step('computer: hint bubble sits on the stage, not under the video', async () => {
  const { page } = desk;
  const tip = await page.$('.coach-tip');
  if (!tip) return log('no hint shown at this step');
  const t = await rect(page, '.coach-tip');
  const stage = await rect(page, '.stage-wrap');
  log('hint', Math.round(t.x), '→', Math.round(t.r), '· stage', Math.round(stage.x), '→', Math.round(stage.r));
  expect(t.x >= stage.x && t.r <= stage.r, 'hint fully inside the stage area');
});

await step('computer: drag the edges, kept after reload, double-click resets', async () => {
  const { page } = desk;
  const col0 = await rect(page, '.side-col');
  const insp0 = await rect(page, '.inspector-col');
  await dragBy(page, '.side-col > .panel-resizer', 160);
  await dragBy(page, '.inspector-col > .panel-resizer', -120);
  const col1 = await rect(page, '.side-col');
  const insp1 = await rect(page, '.inspector-col');
  const video1 = await rect(page, '.side-col > .ref-video.column');
  log(`column ${Math.round(col0.w)} → ${Math.round(col1.w)} · settings ${Math.round(insp0.w)} → ${Math.round(insp1.w)} · video ${Math.round(video1.h)} tall`);
  expect(near(col1.w, col0.w + 160, 4), 'column wider by the drag');
  expect(near(insp1.w, insp0.w + 120, 4), 'settings panel wider by the drag');
  await page.screenshot({ path: `${SP}/panels-02-resized.png` });
  await page.reload();
  await page.waitForSelector('.side-col > .ref-video.column');
  await page.waitForTimeout(500);
  const col2 = await rect(page, '.side-col');
  const insp2 = await rect(page, '.inspector-col');
  expect(near(col2.w, col1.w, 2) && near(insp2.w, insp1.w, 2), 'sizes kept after reload');
  await dragBy(page, '.side-col > .panel-resizer', -2000);
  const colMin = await rect(page, '.side-col');
  await dragBy(page, '.side-col > .panel-resizer', 3000);
  const colMax = await rect(page, '.side-col');
  const stageAtMax = await rect(page, '.stage-wrap');
  log(`column limits ${Math.round(colMin.w)}–${Math.round(colMax.w)} · stage keeps ${Math.round(stageAtMax.w)} px`);
  expect(colMin.w >= 239 && stageAtMax.w >= 319, 'limits keep panels and stage usable');
  await page.dblclick('.side-col > .panel-resizer');
  await page.dblclick('.inspector-col > .panel-resizer');
  await page.waitForTimeout(250);
  const col3 = await rect(page, '.side-col');
  const insp3 = await rect(page, '.inspector-col');
  expect(near(col3.w, col0.w, 2) && near(insp3.w, insp0.w, 2), 'double-click gives the usual sizes back');
});

await step('computer: hiding the video gives the plain formations list back', async () => {
  const { page } = desk;
  await page.click('.ref-bar button[title="Masquer"]');
  await page.waitForTimeout(300);
  expect(!(await page.$('.side-col > .ref-video')), 'video gone from the column');
  const col = await rect(page, '.side-col');
  log('formations column', Math.round(col.w));
  expect(near(col.w, 200, 2), 'usual 200 px list');
  expect(await page.$('.stage-wrap .ref-show'), '"Vidéo" button on the stage to show it again');
  await page.click('.stage-wrap .ref-show');
  await page.waitForSelector('.side-col > .ref-video.column');
});

await step('computer: notifications at the top, clear of the timeline and dialog buttons', async () => {
  const { page } = desk;
  await page.keyboard.press('Escape');
  await page.click('button[title^="Nouvelle formation"]');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForSelector('.toast.show');
  await page.waitForTimeout(300);
  const t = await rect(page, '.toast');
  const tl = await rect(page, '.timeline');
  const stage = await rect(page, '.stage-wrap');
  log('toast', Math.round(t.y), '→', Math.round(t.b), '· stage top', Math.round(stage.y), '· timeline top', Math.round(tl.y));
  expect(t.b < tl.y && t.y >= stage.y - 2, 'toast over the top of the stage');
  await page.screenshot({ path: `${SP}/panels-03-toast.png` });
});

await desk.ctx.close();

/* ------------------------------- laptop ------------------------------- */
await step('small laptop (1000 px): columns fit, resizing works', async () => {
  const { ctx, page } = await editor({ viewport: { width: 1000, height: 700 } }, 'laptop');
  const col = await rect(page, '.side-col');
  const insp = await rect(page, '.inspector-col');
  const stage = await rect(page, '.stage-wrap');
  log(`column ${Math.round(col.w)} · stage ${Math.round(stage.w)} · settings ${Math.round(insp.w)}`);
  expect(stage.w >= 320, 'stage keeps room');
  await dragBy(page, '.side-col > .panel-resizer', 80);
  const col2 = await rect(page, '.side-col');
  expect(near(col2.w, col.w + 80, 4), 'resizes');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW <= 1000, 'no sideways scroll');
  await page.screenshot({ path: `${SP}/panels-04-laptop.png` });
  await ctx.close();
});

/* -------------------------------- phone -------------------------------- */
await step('phone: no columns, no handles, floating video as before', async () => {
  const { ctx, page } = await editor({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true }, 'phone');
  expect(!(await page.$('.side-col')) && !(await page.$('.panel-resizer')), 'phone layout untouched');
  await page.tap('.sheet-close, .inspector .icon-btn[aria-label="Fermer"]').catch(() => {});
  await page.waitForTimeout(400);
  expect(await page.$('.stage-wrap .ref-video.floating'), 'floating video');
  await page.screenshot({ path: `${SP}/panels-05-phone.png` });
  await ctx.close();
});

await step('phone sideways (740×360): video beside the stage as before', async () => {
  const { ctx, page } = await editor({ viewport: { width: 740, height: 360 }, userAgent: IPHONE, isMobile: true, hasTouch: true }, 'landscape');
  await page.tap('.sheet-close, .inspector .icon-btn[aria-label="Fermer"]').catch(() => {});
  await page.waitForTimeout(400);
  expect(await page.$('.stage-wrap.ref-docked .ref-video.docked'), 'docked in the stage area');
  expect(!(await page.$('.panel-resizer')), 'no handles');
  await page.screenshot({ path: `${SP}/panels-06-landscape.png` });
  await ctx.close();
});

await step('wide phone sideways (932×430): phone layout, not three tiny columns', async () => {
  const { ctx, page } = await editor({ viewport: { width: 932, height: 430 }, userAgent: IPHONE, isMobile: true, hasTouch: true }, 'wide-landscape');
  expect(!(await page.$('.side-col')) && !(await page.$('.panel-resizer')), 'no desktop columns');
  const toolbar = await page.$eval('.toolbar', (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  expect(toolbar, 'phone toolbar shown');
  const stage = await rect(page, '.stage-wrap');
  log('stage', Math.round(stage.w), '×', Math.round(stage.h));
  expect(stage.h >= 180, 'stage keeps a usable height');
  await page.screenshot({ path: `${SP}/panels-07-wide-landscape.png` });
  await ctx.close();
});

await browser.close();
console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno errors');
