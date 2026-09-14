// Shared helpers of the browser tests.
import { chromium } from 'playwright-core';

export const BASE = 'http://127.0.0.1:8811/lineup/';
export const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEFAULT_CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

export const launch = (args = []) => chromium.launch({ executablePath: process.env.CHROME || DEFAULT_CHROME, args });

/** Runs named steps, prints ✓ / ✗, exits 1 when one failed. */
export function runner() {
  const errors = [];
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('✓', name);
    } catch (e) {
      errors.push(`${name}: ${e.message.split('\n')[0]}`);
      console.log('✗', name, e.message.split('\n')[0]);
    }
  };
  const finish = () => {
    console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nno errors');
    if (errors.length) process.exitCode = 1;
  };
  return { errors, step, finish, log: (...a) => console.log('  •', ...a) };
}

export const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Fails the run on page errors and console errors. */
export function watch(page, tag, errors) {
  page.on('pageerror', (e) => errors.push(`[${tag}] PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|XNNPACK|odml.pa.googleapis.com/.test(m.text()) && errors.push(`[${tag}] ${m.text().slice(0, 200)}`));
}

/** Opens the app in a new context with the tour and hints off. */
export async function open(browser, ctxOpts, tag, errors) {
  const ctx = await browser.newContext({ ...ctxOpts, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('fs-tour-done', '1');
    localStorage.setItem('fs-coach-off', '1');
  });
  const page = await ctx.newPage();
  watch(page, tag, errors);
  await page.goto(BASE);
  await page.waitForSelector('.lib-top');
  const touch = !!ctxOpts.hasTouch;
  return { ctx, page, touch, tap: (sel) => (touch ? page.tap(sel) : page.click(sel)) };
}
