// Phone audit: visits every screen, dialog, menu and panel, and flags controls that are clipped, covered,
// truncated or off screen. Usage: SP=... node phone-audit.mjs [viewportName]
import { chromium } from 'playwright-core';

const SP = process.env.SP;
const BASE = 'http://127.0.0.1:8811/lineup/';
const URL_ = 'https://tjowfhkiioppzyfwlrqw.supabase.co';
// service key of the account service (creates and removes the audit account): never in the repository
import { readFileSync } from 'node:fs';
const SECRET = process.env.SUPABASE_SECRET || readFileSync(`${process.env.HOME}/.formation-studio/supabase-secret`, 'utf8').trim();
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const VIEWPORTS = {
  iphone13: { width: 390, height: 844, ua: IPHONE_UA },
  iphoneSE: { width: 375, height: 667, ua: IPHONE_UA },
  android360: { width: 360, height: 740, ua: ANDROID_UA },
};
const only = process.argv[2];
const PASS = 'audit-pass-123';

/* ---------------------------- in-page checks ---------------------------- */
function auditInPage(rootSel) {
  const vw = innerWidth;
  const vh = innerHeight;
  const root = document.querySelector(rootSel) || document.body;
  const sheetClosed = !document.querySelector('.editor.sheet-open');
  const issues = [];
  const label = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || el.className || el.tagName)
      .toString()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 38);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let a = el, i = 0; a && i < 12; a = a.parentElement, i++) {
      const cs = getComputedStyle(a);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    }
    if (sheetClosed && el.closest('.inspector')) return false; // closed phone sheet sits off screen on purpose
    if (el.closest('details:not([open])') && !el.closest('summary')) return false;
    return true;
  };
  const clip = (el) => {
    let l = 0, t = 0, r = vw, b = vh;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) {
        const ar = a.getBoundingClientRect();
        l = Math.max(l, ar.left);
        t = Math.max(t, ar.top);
        r = Math.min(r, ar.right);
        b = Math.min(b, ar.bottom);
      }
    }
    return { l, t, r, b };
  };
  const inside = (el) => {
    const er = el.getBoundingClientRect();
    const c = clip(el);
    return er.left >= c.l - 1.5 && er.right <= c.r + 1.5 && er.top >= c.t - 1.5 && er.bottom <= c.b + 1.5;
  };
  const controls = [...root.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, summary, [role=button]')].filter(visible);
  for (const el of controls) {
    const name = label(el);
    if (!inside(el)) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!inside(el)) {
      const er = el.getBoundingClientRect();
      const c = clip(el);
      issues.push({ type: 'clipped', name, detail: `el ${Math.round(er.left)},${Math.round(er.top)}–${Math.round(er.right)},${Math.round(er.bottom)} visible area ${Math.round(c.l)},${Math.round(c.t)}–${Math.round(c.r)},${Math.round(c.b)}` });
      continue;
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const er = el.getBoundingClientRect();
    const cx = er.left + er.width / 2;
    const cy = er.top + er.height / 2;
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.tagName === 'INPUT' && top.closest('label')?.contains(el))) {
      issues.push({ type: 'covered', name, detail: `by ${(top.className?.toString?.() || top.tagName).slice(0, 40)}` });
    }
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY') && el.textContent.trim()) {
      if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4) issues.push({ type: 'text-cut', name, detail: `${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}` });
      for (const child of el.querySelectorAll('span, b')) {
        if (child.scrollWidth > child.clientWidth + 2 && getComputedStyle(child).overflow !== 'visible') issues.push({ type: 'text-cut', name, detail: 'inner label truncated' });
      }
    }
    if (er.height < 28 && el.tagName !== 'INPUT' && !el.closest('.tl-scroll')) issues.push({ type: 'small', name, detail: `${Math.round(er.width)}x${Math.round(er.height)}` });
  }
  if (document.documentElement.scrollWidth > vw + 1) issues.push({ type: 'page-scrolls-sideways', name: 'document', detail: `${document.documentElement.scrollWidth}px` });
  return issues;
}

/* --------------------------------- flow --------------------------------- */
async function runViewport(browser, vpName, vp, userEmail) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, userAgent: vp.ua, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('fs-tour-done', '1');
    localStorage.setItem('fs-coach-off', '1');
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const results = [];
  let n = 0;
  const tap = (sel) => page.tap(sel, { timeout: 8000 });
  const esc = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  };
  const state = async (name, root, setup) => {
    n++;
    const id = `${String(n).padStart(2, '0')}-${name}`;
    try {
      if (setup) await setup();
      await page.waitForTimeout(450);
      const issues = await page.evaluate(auditInPage, root);
      await page.screenshot({ path: `${SP}/audit-${vpName}-${id}.png` });
      results.push({ id, issues });
    } catch (e) {
      results.push({ id, issues: [{ type: 'STEP-FAILED', name, detail: e.message.split('\n')[0].slice(0, 140) }] });
    }
  };
  const openSheet = async (label) => {
    if (await page.$('.editor.sheet-open')) await esc();
    await tap(`.toolbar button:has-text("${label}")`);
    await page.waitForSelector('.editor.sheet-open');
  };
  const openSection = async (title) => {
    const head = await page.$(`.inspector .collapsible-head:has-text("${title}")`);
    if (head && (await head.getAttribute('aria-expanded')) !== 'true') await head.tap();
  };
  const libMenu = async (item) => {
    await tap('.lib-actions button[aria-label="Plus"]');
    if (item) await tap(`.menu.floating button:has-text("${item}")`);
  };

  /* library, signed out */
  await page.goto(BASE);
  await page.waitForSelector('.lib-top');
  await state('library-empty', 'body');
  await state('search-open', 'body', () => tap('.search-toggle'));
  await state('library-menu', '.menu.floating', () => libMenu());
  await esc();
  await state('install', '.modal', () => tap('.install-btn'));
  await state('install-other-options', '.modal', () => tap('.install-details summary'));
  await esc();
  await state('share-lineup', '.modal', () => libMenu('Partager Lineup'));
  await esc();
  await state('transfer', '.modal', () => libMenu('Transférer'));
  await esc();
  await state('login', '.modal', () => tap('.account-login'));
  await state('login-signup', '.modal', () => tap('.account-form .segmented button:has-text("Créer un compte")'));
  await state('login-error', '.modal', async () => {
    await tap('.account-form .segmented button:has-text("Connexion")');
    await page.fill('.account-form input[type=email]', 'pas-un-email');
    await tap('.account-form .btn.primary');
  });
  await state('forgot', '.modal', () => tap('.account-form .link-btn:has-text("Mot de passe oublié")'));
  await esc();

  /* creation flow */
  await state('flow-dancers', '.flow', () => tap('.fab'));
  await state('flow-stage', '.flow', () => tap('.flow-foot .btn.primary'));
  await state('flow-music', '.flow', () => tap('.flow-foot .btn.primary'));
  await state('flow-music-done', '.flow', async () => {
    await page.setInputFiles('.flow input[type=file]', `${SP}/beat120.wav`);
    await page.waitForSelector('.flow-music.done', { timeout: 15000 });
  });
  await state('flow-name', '.flow', () => tap('.flow-foot .btn.primary'));
  await tap('.flow-foot .btn.primary');
  await page.waitForSelector('g.dancer', { timeout: 15000 });

  /* editor */
  await state('editor', 'body');
  await state('editor-selection-bar', 'body', async () => {
    const d = await page.$('g.dancer');
    const b = await d.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForSelector('.selbar');
  });
  await page.tap('.selbar-close').catch(() => {});
  await state('project-switcher', '.menu.floating', () => tap('.switch-btn'));
  await esc();
  await tap('.add-formation');
  await state('formation-menu', '.menu.floating', () => tap('.formation-item.on'));
  await state('formation-rename', '.modal', () => tap('.menu.floating button:has-text("Renommer")'));
  await esc();
  await state('timeline-open', 'body', async () => {
    const collapsed = await page.$('.timeline.collapsed');
    if (collapsed) await tap('.tl-toggle');
  });
  await state('player-menu', '.menu.floating', () => tap('.player button[title^="Options de lecture"]'));
  await esc();

  await state('sheet-formes', '.inspector', () => openSheet('Formes'));
  await state('sheet-formes-all', '.inspector', () => tap('.inspector button:has-text("Toutes les formes")'));
  await state('sheet-formes-ajuster', '.inspector', () => openSection('Ajuster'));
  await state('sheet-formes-selection', '.inspector', async () => {
    await esc();
    const d = await page.$('g.dancer');
    const b = await d.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await openSheet('Formes');
    await openSection('Trajet');
  });
  await state('sheet-formation', '.inspector', async () => {
    await openSheet('Formation');
    await openSection('Vitesse');
  });
  await state('sheet-membres', '.inspector', async () => {
    await esc();
    await page.evaluate(() => document.querySelectorAll('g.dancer').length);
    await openSheet('Membres');
    await openSection('Équipes');
  });
  await state('sheet-objets', '.inspector', async () => {
    await openSheet('Objets');
    await tap('.prop-preset >> nth=0');
  });
  await state('sheet-plus', '.inspector', () => openSheet('Plus'));
  await state('sheet-musique', '.inspector', async () => {
    await tap('.more-row:has-text("Musique")');
    await openSection('Avancé');
    await openSection('Répétition');
  });
  await state('sheet-scene', '.inspector', async () => {
    await tap('.phone-back');
    await tap('.more-row:has-text("Scène")');
    await openSection('Repères');
    await openSection('Avancé');
  });
  await state('video-dialog', '.modal', async () => {
    await openSheet('Plus');
    await tap('.more-row:has(span.grow:text-is("Exporter en vidéo"))');
  });
  await esc();
  await state('sheet-video-reference', '.inspector', async () => {
    await openSheet('Plus');
    await tap('.more-row:has-text("Vidéo de référence")');
    await page.waitForSelector('.inspector .dropzone');
  });
  await esc();
  await state('share-signed-out', '.modal', async () => {
    await openSheet('Plus');
    await tap('.more-row:has-text("Partager en direct")');
  });
  await esc();
  await state('guide-dialog', '.modal', async () => {
    await openSheet('Plus');
    await tap('.more-row:has-text("Guide")');
  });
  await esc();
  await state('tour', '.tour-card', async () => {
    await openSheet('Plus');
    await tap('.more-row:has-text("Visite guidée")');
    await page.waitForSelector('.tour-card');
  });
  await page.tap('.tour-actions .link-btn').catch(() => {});
  await state('view-3d', 'body', async () => {
    await openSheet('Plus');
    await tap('.more-row:has-text("Vue 3D")');
    await page.waitForTimeout(1200);
  });
  await openSheet('Plus');
  await tap('.more-row:has-text("Vue 3D")').catch(() => {});
  await esc();

  /* library, filled */
  await page.goto(BASE);
  await page.waitForSelector('.card:not(.new-card)');
  await state('library-filled', 'body');
  await state('card-menu', '.menu.floating', () => tap('.card:not(.new-card) .card-title .icon-btn'));
  await state('card-rename', '.modal', () => tap('.menu.floating button:has-text("Renommer")'));
  await esc();
  await state('folder-new', '.modal', () => tap('.folder-chips .chip.ghost'));
  await esc();

  /* teams, templates, guide */
  await state('teams', 'body', () => tap('.tabbar button:has-text("Équipes")'));
  await state('team-new', '.modal', async () => {
    await tap('.lib-content .section-intro .btn.primary');
    for (let i = 0; i < 3; i++) await page.tap('.modal .member-editor ~ .btn, .modal .btn.small:has-text("Ajouter")').catch(() => {});
  });
  await state('team-saved', 'body', async () => {
    await page.fill('.modal .field input >> nth=0', 'Groupe du jeudi').catch(() => {});
    await tap('.modal-foot .btn.primary');
  });
  await state('templates', 'body', () => tap('.tabbar button:has-text("Modèles")'));
  await state('guide-tab', 'body', () => tap('.tabbar button:has-text("Guide")'));

  /* signed in */
  await tap('.tabbar button:has-text("Bibliothèque")');
  await tap('.account-login');
  await page.fill('.account-form input[type=email]', userEmail);
  await page.fill('.account-form .password-field input', PASS);
  await tap('.account-form .btn.primary');
  await page.waitForSelector('.account-btn', { timeout: 20000 });
  await state('account', '.modal', () => tap('.account-btn'));
  await state('account-password', '.modal', () => tap('.more-row:has-text("Changer le mot de passe")'));
  await esc();
  await state('account-delete', '.modal', async () => {
    await tap('.account-btn');
    await tap('.more-row:has-text("Supprimer le compte")');
  });
  await state('account-delete-confirm', '.modal', () => tap('.btn.danger-solid:has-text("Continuer")'));
  await esc();
  await page.tap('.card:not(.new-card)');
  await page.waitForSelector('g.dancer');
  await state('share-enable', '.modal', async () => {
    await openSheet('Plus');
    await tap('.more-row:has-text("Partager en direct")');
  });
  await state('share-active', '.modal', async () => {
    await tap('.modal .btn.primary:has-text("Activer le partage")');
    await page.waitForSelector('.share-row', { timeout: 20000 });
    await page.waitForTimeout(1500);
  });
  await state('share-active-qr', '.modal', () => tap('.share-row .btn:has-text("QR code") >> nth=0'));
  await esc();
  await state('join-signed-out-card', 'body', async () => {
    const ctx2 = page; // same tab: sign-out view of a join link
    await ctx2.goto(`${BASE}#/join/00000000-0000-0000-0000-000000000000/x`);
    await page.waitForTimeout(1500);
  });
  const docId = await page.evaluate(() => new Promise((res) => {
    const o = indexedDB.open('fs-choreos');
    o.onsuccess = () => {
      const q = o.result.transaction('kv').objectStore('kv').getAllKeys();
      q.onsuccess = () => res(q.result[0]);
    };
  }));
  await state('print-page', 'body', async () => {
    await page.goto(`${BASE}#/print/${docId}`);
    await page.waitForTimeout(2500);
  });

  await ctx.close();
  return { results, pageErrors };
}

/* --------------------------------- main --------------------------------- */
const email = `fs-test-audit-${Date.now()}@example.com`;
const created = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SECRET, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS, email_confirm: true }) })).json();
const browser = await chromium.launch({ executablePath: exe });
const summary = {};
try {
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    if (only && only !== name) continue;
    const { results, pageErrors } = await runViewport(browser, name, vp, email);
    summary[name] = results;
    const flagged = results.filter((r) => r.issues.length);
    console.log(`\n=== ${name} (${vp.width}x${vp.height}) — ${results.length} screens, ${flagged.length} with issues${pageErrors.length ? `, page errors: ${pageErrors.slice(0, 2).join(' | ')}` : ''}`);
    for (const r of flagged) {
      const byType = {};
      for (const i of r.issues) (byType[i.type] ??= []).push(`${i.name} [${i.detail}]`);
      console.log(`  ${r.id}`);
      for (const [t, list] of Object.entries(byType)) console.log(`    ${t}: ${[...new Set(list)].slice(0, 6).join(' ; ')}${list.length > 6 ? ` (+${list.length - 6})` : ''}`);
    }
  }
} finally {
  await browser.close();
  if (created.id) {
    // rooms of the audit account go with it; its shared music folder too
    await fetch(`${URL_}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SECRET } });
  }
  (await import('node:fs')).writeFileSync(`${SP}/audit-summary.json`, JSON.stringify(summary, null, 1));
  console.log('\naudit account removed; details in audit-summary.json');
}
