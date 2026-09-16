/**
 * Screenshots for docs/walkthrough.md.
 *
 *   pnpm docs:screens
 *
 * Drives a real Chrome over the DevTools Protocol — no Playwright, no
 * Puppeteer, no 130MB browser download. Node has had a global WebSocket since
 * 22, and CDP is just JSON over one, so the whole thing is dependency-free and
 * will still run in a year.
 *
 * It photographs the app as a passenger, an operator, an admin and a driver
 * would actually see it, by signing in and clicking through — not by rendering
 * components in isolation. A screenshot of a screen that cannot be reached is
 * worse than no screenshot.
 *
 * Before running:
 *
 *   pnpm db:reset          # the walkthrough tells the seed's story
 *   pnpm functions:serve   # payment and boarding go through Edge Functions
 *   pnpm web               # on port 8090
 *
 * and point the app at the LOCAL stack, or you will photograph production.
 * The script refuses to start if it is not pointed at localhost.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.WALKTHROUGH_URL ?? 'http://localhost:8090';
const OUT = path.resolve(import.meta.dirname, '..', 'docs', 'screenshots');
const PASSWORD = 'PalawanGo2026';

/** A phone, at 2x, because these are read on a laptop. */
const DEVICE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
/** The consoles are desktop-first and unreadable squeezed into a phone. */
const DESKTOP = { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false };

const CHROME = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));

if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH or install Chrome.');

if (!/localhost|127\.0\.0\.1/.test(APP)) {
  throw new Error(`Refusing to run against ${APP}. These screenshots are of seed data.`);
}

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// CDP plumbing
// ---------------------------------------------------------------------------

let nextId = 1;
const pending = new Map();

function rpc(ws, method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 30_000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chromeEndpoint(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Chrome never opened its debugging port.');
}

// ---------------------------------------------------------------------------
// Acting on the page
//
// React Native Web renders real DOM, but React listens for its own synthetic
// events — assigning `.value` changes nothing it can see. Typing therefore goes
// through the native setter plus an `input` event, and clicking goes through
// real CDP mouse events at the element's centre rather than `el.click()`, which
// RNW's Pressable does not always hear.
// ---------------------------------------------------------------------------

class Page {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return rpc(this.ws, method, params, this.sessionId);
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed');
    return result.value;
  }

  async device(metrics) {
    await this.send('Emulation.setDeviceMetricsOverride', { ...metrics, screenWidth: metrics.width, screenHeight: metrics.height });
  }

  async go(route) {
    await this.send('Page.navigate', { url: `${APP}${route}` });
    await sleep(2500);
  }

  /** The rect of the first element whose visible text or placeholder matches. */
  async rectOf(text, { exact = false } = {}) {
    return this.evaluate(`(() => {
      const needle = ${JSON.stringify(text)}.toLowerCase();
      const hit = (s) => s && (${exact} ? s.toLowerCase() === needle : s.toLowerCase().includes(needle));
      const candidates = [...document.querySelectorAll('input, textarea, [role="button"], [role="link"], div, span')];
      for (const el of candidates.reverse()) {
        const label = el.placeholder || el.getAttribute('aria-label') || '';
        const own = el.children.length === 0 ? el.textContent : '';
        if (!hit(label) && !hit(own)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.top > innerHeight) continue;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName };
      }
      return null;
    })()`);
  }

  async click(text, options) {
    const rect = await this.rectOf(text, options);
    if (!rect) throw new Error(`Nothing clickable matching "${text}"`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
    }
    await sleep(900);
  }

  /** Fills the input whose placeholder or label matches, the way React hears it. */
  async fill(match, value) {
    const ok = await this.evaluate(`(() => {
      const needle = ${JSON.stringify(match)}.toLowerCase();
      const el = [...document.querySelectorAll('input, textarea')].find((i) => {
        const label = (i.placeholder || i.getAttribute('aria-label') || '').toLowerCase();
        return label.includes(needle);
      });
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`No field matching "${match}"`);
    await sleep(300);
  }

  /** Waits until some text appears, so a shot is never of a half-drawn screen. */
  async waitFor(text, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const seen = await this.evaluate(
        `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
      );
      if (seen) {
        await sleep(600);
        return true;
      }
      await sleep(400);
    }
    throw new Error(`Timed out waiting for "${text}"`);
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`  ${name}.png`);
  }

  /**
   * The first search result.
   *
   * By position, not by name: the seed dates its trips relative to `now()`, so
   * `CHERRY-0915-A` is correct for exactly one day.
   */
  async clickFirstResult() {
    const rect = await this.evaluate(`(() => {
      const card = [...document.querySelectorAll('[role="button"]')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.height > 90 && r.width > 200 && /₱/.test(el.textContent ?? ''))
        .sort((a, b) => a.r.top - b.r.top)[0];
      if (!card) return null;
      return { x: card.r.x + card.r.width / 2, y: card.r.y + 40 };
    })()`);
    if (!rect) throw new Error('No search result card on screen');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, ...rect, button: 'left', clickCount: 1 });
    }
    await sleep(1500);
  }

  async signOut() {
    // The app's origin has to be loaded before its storage can be touched —
    // `localStorage` on `about:blank` throws a SecurityError, which silently
    // took out every passenger step on the first run.
    await this.go('/');
    await this.evaluate('try { localStorage.clear(); sessionStorage.clear(); } catch {} true');
    await this.go('/');
    await this.waitFor('Welcome back');
  }

  async signIn(email) {
    await this.signOut();
    await this.fill('you@example.com', email);
    await this.fill('Your password', PASSWORD);
    await this.click('Sign in');
    await sleep(4000);
  }
}

// ---------------------------------------------------------------------------

const port = 9333;
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${path.join(process.env.TEMP ?? '/tmp', 'palago-walkthrough')}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

process.on('exit', () => chrome.kill());

const ws = new WebSocket(await chromeEndpoint(port));
await new Promise((resolve) => ws.addEventListener('open', resolve));

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
});

const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank' });
const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
const page = new Page(ws, sessionId);

await page.send('Page.enable');
await page.send('Runtime.enable');
await page.device(DEVICE);

export { page, DEVICE, DESKTOP, sleep };

// The story is in `scripts/walkthrough-steps.mjs`, so the plumbing above stays
// plumbing and the shot list reads like the document it produces.
const { capture } = await import('./walkthrough-steps.mjs');

try {
  await capture(page, { DEVICE, DESKTOP, sleep, PASSWORD });
  console.log(`\nWrote ${fs.readdirSync(OUT).length} screenshots to docs/screenshots/`);
} finally {
  chrome.kill();
  ws.close();
}

process.exit(0);
