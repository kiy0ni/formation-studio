// Automatic detection: analysis of a real dance practice (6 dancers), review, apply (all / positions),
// undo, positions on the stage, place from the image, and the phone layout (3 dancers for 6 people).
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const SP = process.env.SP;
const CLIP = process.env.CLIP || `${SP}/clip.mp4`;
const DUMP = `${SP}/detect/analysis-youdaone.json`;
const BASE = 'http://127.0.0.1:8811/formation-studio/';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
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

const readDoc = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const o = indexedDB.open('fs-choreos');
        o.onsuccess = () => {
          const r = o.result.transaction('kv').objectStore('kv').getAll();
          r.onsuccess = () => res(r.result.sort((a, b) => b.updatedAt - a.updatedAt)[0]);
        };
      }),
  );
const readAnalysis = (page, hash) =>
  page.evaluate(
    (hash) =>
      new Promise((res) => {
        const o = indexedDB.open('fs-detect');
        o.onupgradeneeded = () => o.result.createObjectStore('kv');
        o.onsuccess = () => {
          const r = o.result.transaction('kv').objectStore('kv').get('a:' + hash);
          r.onsuccess = () => res(r.result ?? null);
        };
      }),
    hash,
  );
const writeAnalysis = (page, analysis) =>
  page.evaluate(
    (a) =>
      new Promise((res) => {
        const o = indexedDB.open('fs-detect');
        o.onupgradeneeded = () => o.result.createObjectStore('kv');
        o.onsuccess = () => {
          const tx = o.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(a, 'a:' + a.hash);
          tx.objectStore('kv').put({ version: a.version, fps: a.fps, done: true }, 'm:' + a.hash);
          tx.oncomplete = () => res(true);
        };
      }),
    analysis,
  );

async function newEditor(ctxOpts, tag, dancers) {
  const ctx = await browser.newContext({ ...ctxOpts, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('fs-tour-done', '1');
    localStorage.setItem('fs-coach-off', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|XNNPACK|odml.pa.googleapis.com/.test(m.text()) && errors.push(`[${tag}] ${m.text().slice(0, 200)}`));
  await page.goto(BASE);
  await page.waitForSelector('.lib-top');
  const touch = !!ctxOpts.hasTouch;
  const tap = (sel) => (touch ? page.tap(sel) : page.click(sel));
  await tap(touch ? '.fab' : '.new-btn');
  await page.fill('.flow-slider', String(dancers));
  await tap('.flow-foot .btn.primary');
  await tap('.flow-foot .btn.primary');
  await tap('.flow-foot .btn.ghost:has-text("Plus tard")');
  await page.fill('.flow-input', `Détection ${tag}`);
  await tap('.flow-foot .btn.primary');
  await page.waitForSelector('g.dancer');
  return { ctx, page, tap, touch };
}

async function addVideo({ page, tap, touch }) {
  if (touch) {
    await tap('.toolbar button:has-text("Plus")');
    await tap('.more-row:has-text("Vidéo de référence")');
  } else {
    await page.click('.topbar button:has-text("Vidéo")');
  }
  await page.waitForSelector('.dropzone');
  await page.setInputFiles('.inspector input[type=file]', CLIP);
  await page.waitForSelector('.inspector .music-card', { timeout: 120000 });
  await page.waitForSelector('.detect-section');
}

/* ------------------------------ computer ------------------------------ */
const desk = await newEditor({ viewport: { width: 1440, height: 900 } }, 'desktop', 6);
let analysis = null;

await step('desktop: analyse a 3:29 dance practice (6 dancers)', async () => {
  const { page } = desk;
  await addVideo(desk);
  await page.screenshot({ path: `${SP}/det-01-section.png` });
  await page.click('.detect-section .btn.primary');
  await page.waitForSelector('.detect-intro');
  await page.screenshot({ path: `${SP}/det-02-intro.png` });
  const t0 = Date.now();
  await page.click('.detect-intro .btn.primary');
  await page.waitForSelector('.detect-progress');
  await page.waitForTimeout(20000);
  log('progress after 20 s:', await page.$eval('.detect-progress span', (e) => e.textContent));
  await page.screenshot({ path: `${SP}/det-03-progress.png` });
  await page.waitForSelector('.detect-review', { timeout: 900000 });
  log(`analysis took ${Math.round((Date.now() - t0) / 1000)} s`);
  const doc = await readDoc(page);
  analysis = await readAnalysis(page, doc.video.hash);
  expect(analysis?.frames?.length > 500, 'analysis saved');
  writeFileSync(DUMP, JSON.stringify(analysis));
  const counts = analysis.frames.map((f) => f.filter((d) => d.s >= 0.3).length);
  const hist = {};
  counts.forEach((n) => (hist[n] = (hist[n] || 0) + 1));
  log('images:', counts.length, '· people seen per image:', JSON.stringify(hist));
});

await step('desktop: review shows formations, people and who dances who', async () => {
  const { page } = desk;
  await page.waitForTimeout(600);
  const summary = await page.$eval('.detect-summary', (e) => e.textContent);
  const chips = await page.$$eval('.detect-chips button', (els) => els.map((e) => e.textContent));
  const people = await page.$$eval('.detect-person select', (els) => els.map((s) => s.selectedOptions[0]?.textContent));
  log(summary, '·', chips.join(' | '));
  log('who dances who:', people.join(', '));
  expect(chips.length >= 3, 'several formations found');
  expect(people.length === 6, `6 people followed (got ${people.length})`);
  expect(people.every((p) => p !== 'Ignorer'), 'all dancers matched');
  await page.screenshot({ path: `${SP}/det-04-review.png` });
  for (const i of [2, Math.floor(chips.length / 2), chips.length - 1]) {
    await page.click(`.detect-chips button >> nth=${i}`);
    await page.waitForTimeout(250);
    await page.locator('.detect-compare').screenshot({ path: `${SP}/det-05-formation-${i + 1}.png` });
  }
  await page.fill('.detect-range input', '1');
  await page.waitForTimeout(300);
  const more = await page.$$eval('.detect-chips button', (els) => els.length);
  await page.fill('.detect-range input', '0');
  await page.waitForTimeout(300);
  const fewer = await page.$$eval('.detect-chips button', (els) => els.length);
  log(`slider: fewest ${fewer} · default ${chips.length} · most ${more}`);
  expect(fewer <= chips.length && more >= chips.length, 'slider changes the number of formations');
  await page.fill('.detect-range input', '0.5');
});

await step('desktop: swap two people from a formation', async () => {
  const { page } = desk;
  await page.click('.detect-chips button >> nth=3');
  const before = await page.$$eval('.detect-dot', (els) => els.map((e) => e.getAttribute('transform')));
  await page.click('.detect-dot >> nth=0');
  await page.click('.detect-dot >> nth=1');
  await page.click('.detect-swap .btn.primary');
  await page.waitForTimeout(300);
  const after = await page.$$eval('.detect-dot', (els) => els.map((e) => e.getAttribute('transform')));
  expect(before[0] === after[1] && before[1] === after[0], 'positions exchanged');
  // undo the test swap through a new selection
  await page.click('.detect-dot >> nth=0');
  await page.click('.detect-dot >> nth=1');
  await page.click('.detect-swap .btn.primary');
});

await step('desktop: apply everything, then undo', async () => {
  const { page } = desk;
  const chips = await page.$$eval('.detect-chips button', (els) => els.length);
  await page.click('.detect-foot .btn.primary:has-text("Appliquer")');
  await page.waitForSelector('.modal', { state: 'detached' });
  const toast = await page.$eval('.toast', (e) => e.textContent).catch(() => '');
  log('toast:', toast);
  await page.waitForTimeout(1500);
  let doc = await readDoc(page);
  const list = Object.values(doc.formations).sort((a, b) => a.order - b.order);
  log('formations:', list.map((f) => `${f.duration}+${f.transition}`).join(' '));
  expect(list.length === chips, `${chips} formations written (got ${list.length})`);
  const inside = list.every((f) => Object.values(f.positions).every((p) => Math.abs(p.x) <= doc.stage.width / 2 + doc.stage.wingWidth && Math.abs(p.y) <= doc.stage.depth / 2 + 1));
  expect(inside, 'positions on the stage');
  await page.screenshot({ path: `${SP}/det-06-applied.png` });
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1500);
  doc = await readDoc(page);
  expect(Object.keys(doc.formations).length === 1, 'undo brings back the single formation');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(1500);
  doc = await readDoc(page);
  expect(Object.keys(doc.formations).length === chips, 'redo applies it again');
});

await step('desktop: detected positions on the stage during playback', async () => {
  const { page } = desk;
  await page.click('.topbar button:has-text("Vidéo")').catch(() => {});
  await page.waitForTimeout(300);
  if (!(await page.$('.detect-section'))) {
    await page.evaluate(() => document.querySelector('.ref-bar button[title="Réglages"]')?.click());
    await page.waitForSelector('.detect-section');
  }
  await page.click('.detect-section .toggle');
  await page.click('button[title^="Formation suivante"]');
  await page.click('button[title^="Formation suivante"]');
  await page.waitForTimeout(500);
  const ghosts = await page.$$eval('.detect-ghosts circle', (els) => els.length);
  log('ghost circles:', ghosts);
  expect(ghosts === 6, 'six detected positions drawn');
  // held formation: each ghost sits on a dancer (same centring, marks and clock as the written formation)
  const gap = await page.evaluate(() => {
    const dancers = [...document.querySelectorAll('g.dancer')].map((g) => {
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    }).filter(Boolean);
    const gaps = [...document.querySelectorAll('.detect-ghosts circle')].map((c) => {
      const x = Number(c.getAttribute('cx'));
      const y = Number(c.getAttribute('cy'));
      return Math.min(...dancers.map((d) => Math.hypot(d.x - x, d.y - y)));
    }).sort((a, b) => a - b);
    return { median: gaps[gaps.length >> 1], worst: gaps[gaps.length - 1] };
  });
  log('ghost ↔ dancer distance (m):', JSON.stringify(gap));
  expect(gap.median < 0.35, `ghosts on the dancers (median gap ${gap.median.toFixed(2)} m)`);
  await page.screenshot({ path: `${SP}/det-07-ghosts.png` });
});

await step('desktop: place from the image', async () => {
  const { page } = desk;
  await page.click('button[title^="Formation suivante"]');
  await page.waitForTimeout(400);
  const before = await readDoc(page);
  await page.click('.detect-section .btn:has-text("Placer depuis l’image")');
  await page.waitForFunction(() => /placé/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 60000 });
  log('toast:', await page.$eval('.toast', (e) => e.textContent));
  await page.waitForTimeout(1500);
  const after = await readDoc(page);
  const moved = Object.values(after.formations).filter((f) => JSON.stringify(f.positions) !== JSON.stringify(before.formations[f.id]?.positions)).length;
  log('formations changed:', moved);
  expect(moved === 1, 'one formation updated');
  await page.screenshot({ path: `${SP}/det-08-placed.png` });
});

/* ------------------------------- phone ------------------------------- */
await step('phone: 3 dancers for 6 people, review fits the screen, apply positions', async () => {
  if (!analysis && existsSync(DUMP)) analysis = JSON.parse(readFileSync(DUMP, 'utf8'));
  expect(analysis, 'analysis available');
  const phone = await newEditor({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true }, 'phone', 3);
  const { page, tap } = phone;
  await addVideo(phone);
  let doc = null;
  for (let i = 0; i < 30 && !doc?.video; i++) {
    await page.waitForTimeout(300);
    doc = await readDoc(page);
  }
  expect(doc.video.hash === analysis.hash, 'same video, same analysis key');
  await writeAnalysis(page, analysis);
  await page.locator('.detect-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SP}/det-10-phone-section.png` });
  await tap('.detect-section .btn.primary');
  await page.waitForSelector('.detect-review');
  await page.waitForTimeout(500);
  const fit = await page.evaluate(() => {
    const m = document.querySelector('.modal').getBoundingClientRect();
    const body = document.querySelector('.modal-body');
    const wide = [...document.querySelectorAll('.modal *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.detect-chips')).map((e) => e.className?.baseVal ?? e.className);
    return { vw: innerWidth, left: m.left, right: m.right, bodyScrollW: body.scrollWidth, bodyW: body.clientWidth, wide: wide.slice(0, 5) };
  });
  log('phone review:', JSON.stringify(fit));
  expect(fit.right <= fit.vw && fit.bodyScrollW <= fit.bodyW + 1 && !fit.wide.length, 'nothing wider than the screen');
  const people = await page.$$eval('.detect-person select', (els) => els.map((s) => s.selectedOptions[0]?.textContent));
  log('who dances who:', people.join(', '));
  expect(people.filter((p) => p !== 'Ignorer').length === 3, '3 dancers matched, 3 people ignored');
  await page.screenshot({ path: `${SP}/det-11-phone-review-top.png` });
  await page.evaluate(() => (document.querySelector('.modal-body').scrollTop = 99999));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SP}/det-12-phone-review-bottom.png` });
  await tap('.detect-col .segmented button:has-text("Positions")');
  await tap('.detect-foot .btn.primary:has-text("Appliquer")');
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.waitForTimeout(1500);
  const after = await readDoc(page);
  const f = Object.values(after.formations)[0];
  log('positions mode:', Object.keys(after.formations).length, 'formation(s) ·', JSON.stringify(Object.values(f.positions)));
  expect(Object.keys(after.formations).length === 1, 'formations kept');
  await page.screenshot({ path: `${SP}/det-13-phone-applied.png` });
  await phone.ctx.close();
});

await browser.close();
console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno errors');
