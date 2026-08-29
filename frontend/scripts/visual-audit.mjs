/**
 * Audit visuel via Chrome headless + CDP (aucune dépendance ajoutée : ws est
 * déjà dans node_modules, fetch/WebSocket natifs de Node 20).
 *
 * Usage (dev server mock démarré au préalable) :
 *   node scripts/visual-audit.mjs
 *
 * Produit : screenshots/*.png + rapport JSON (contrastes AA, erreurs console,
 * overflow, variables CSS résolues).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const DEBUG_PORT = 9222;
const BASE = process.env.MOCK_BASE_URL || 'http://localhost:5173';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const PROFILE = '/tmp/dt-chrome-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}
function makeJwt(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    companyId: 'c-demo-1',
    firstName: user.firstName,
    lastName: user.lastName,
    exp: Math.floor(Date.now() / 1000) + 7200,
  };
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.mock`;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        }
      } else {
        const hs = this.handlers.get(m.method);
        if (hs) hs.forEach((h) => h(m.params));
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, h) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(h);
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function waitFor(cdp, expr, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result?.value) return true;
    await sleep(250);
  }
  return false;
}

const AUDIT_FN = (selectors) => `(() => {
  const sel = ${JSON.stringify(selectors)};
  const parse = (str) => {
    if (!str) return null;
    const m = str.match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)/);
    if (!m) {
      const h = str.match(/#([0-9a-f]{6})/i);
      if (!h) return null;
      const v = parseInt(h[1], 16);
      return [v >> 16 & 255, v >> 8 & 255, v & 255, 1];
    }
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  };
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [16, 18, 22, 1];
  const effBg = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] > 0) {
        let [r, g, b, a] = bg;
        let [br, bg2, bb] = pageBg;
        return [r * a + br * (1 - a), g * a + bg2 * (1 - a), b * a + bb * (1 - a)];
      }
      node = node.parentElement;
    }
    return pageBg;
  };
  const vars = {};
  ['--color-bg','--color-surface','--color-surface-alt','--color-text','--color-text-secondary','--color-text-tertiary','--color-accent','--color-accent-muted','--color-glass','--color-border','--color-teal','--color-blue','--color-red','--color-warning','--color-skeleton','--font-display','--font-body','--font-mono','--radius-lg','--shadow-sm'].forEach((v) => {
    vars[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  });
  const results = [];
  for (const s of sel) {
    const el = document.querySelector(s);
    if (!el) { results.push({ sel: s, missing: true }); continue; }
    const cs = getComputedStyle(el);
    const color = parse(cs.color);
    const bg = effBg(el);
    const fontSize = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = fontSize >= 18.66 || (fontSize >= 14 && weight >= 700);
    const r = color ? ratio(color, bg) : null;
    results.push({
      sel: s,
      text: (el.textContent || '').trim().slice(0, 40),
      color: cs.color,
      bg: \`rgb(\${bg.map(Math.round).join(',')})\`,
      fontSize,
      weight,
      ratio: r ? Math.round(r * 100) / 100 : null,
      aa: r !== null ? (large ? r >= 3 : r >= 4.5) : null,
      overflowX: el.scrollWidth > el.clientWidth + 1,
    });
  }
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    context: document.documentElement.getAttribute('data-context'),
    title: document.title,
    vars,
    h1: (document.querySelector('h1') || {}).textContent || null,
    bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    viewport: [window.innerWidth, window.innerHeight],
    results,
    resourceErrors: performance.getEntriesByType('resource').filter((r) => r.responseStatus >= 400).map((r) => r.name.slice(0, 120)),
  };
})()`;

async function scenario(name, { route, user, theme, width, height, waitSel, selectors }) {
  const target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  const errors = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') {
      errors.push({ type: p.type, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    errors.push({ type: 'exception', text: (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 300) });
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry?.level === 'error') errors.push({ type: 'log', text: (p.entry.text || '').slice(0, 300) });
  });
  cdp.on('Network.responseReceived', (p) => {
    if (p.response && p.response.status >= 400 && p.type !== 'Document') {
      errors.push({ type: 'http', status: p.response.status, url: p.response.url.slice(0, 160) });
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });

  // Définir le thème sur l'origine avant navigation cible
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await waitFor(cdp, `document.readyState === 'complete'`);
  await sleep(300);
  await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem('dt-theme', '${theme}'); localStorage.removeItem('dt-access-token');` });

  const jwt = makeJwt(user);
  await cdp.send('Page.navigate', { url: `${BASE}${route}?token=${jwt}` });
  await waitFor(cdp, `document.readyState === 'complete'`);
  const ok = await waitFor(cdp, `!!document.querySelector(${JSON.stringify(waitSel)})`);
  await sleep(3500); // laisser les requêtes mock + charts se poser

  const auditRes = await cdp.send('Runtime.evaluate', { expression: AUDIT_FN(selectors), returnByValue: true });
  const audit = auditRes.result?.value ?? { evaluateError: JSON.stringify(auditRes).slice(0, 300) };
  audit.waitSelFound = ok;

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'));

  cdp.close();
  return { name, route, viewport: audit.viewport, theme, context: audit.context, title: audit.title, waitSelFound: ok, errors, audit };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--no-proxy-server',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: 'ignore' });

  // Attendre que le debugger CDP réponde
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try {
      await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      ready = true;
    } catch { await sleep(250); }
  }
  if (!ready) { console.error('Chrome CDP non joignable'); chrome.kill(); process.exit(1); }

  // Les classes CSS Modules sont hashées en dev (_name_hash) : on matche par
  // suffixe [class*="..."] au lieu de la classe exacte.
  const dashboardSelectors = [
    'h1', '[class*="kpiValue"]', '[class*="kpiLabel"]', '[class*="kpiPanelTitle"]',
    '[class*="chartPanelTitle"]', '[class*="recentTitle"]', '[class*="dashboardDate"]',
    '[class*="reliabilityScore"]', '[class*="reliabilityLabel"]',
    '[class*="perfectMonthBadge"]', '[class*="recentStatusPill"]',
  ];
  const driverSelectors = [
    'h1', '[class*="pageTitle"]', '[class*="hello"]', '[class*="summaryLabel"]',
    '[class*="summaryValue"]', '[class*="addressLabel"]', '[class*="addressText"]',
    '[class*="cardTitle"]', '[class*="cardTime"]', '[class*="statusBadge"]', '[class*="livePill"]',
  ];

  const scenarios = [
    {
      name: 'dashboard-dark', route: '/dashboard', theme: 'dark', width: 1440, height: 900,
      user: { id: 'u-admin-1', email: 'admin@demo.dt', role: 'admin', firstName: 'Hery', lastName: 'Rakoto' },
      waitSel: 'h1', selectors: dashboardSelectors,
    },
    {
      name: 'dashboard-light', route: '/dashboard', theme: 'light', width: 1440, height: 900,
      user: { id: 'u-admin-1', email: 'admin@demo.dt', role: 'admin', firstName: 'Hery', lastName: 'Rakoto' },
      waitSel: 'h1', selectors: dashboardSelectors,
    },
    {
      name: 'driver-deliveries', route: '/my-deliveries', theme: 'light', width: 390, height: 844,
      user: { id: 'u-driver-1', email: 'driver@demo.dt', role: 'driver', firstName: 'Mamy', lastName: 'Razafy' },
      waitSel: 'h1', selectors: driverSelectors,
    },
    {
      name: 'driver-vehicle', route: '/my-vehicle', theme: 'light', width: 390, height: 844,
      user: { id: 'u-driver-1', email: 'driver@demo.dt', role: 'driver', firstName: 'Mamy', lastName: 'Razafy' },
      waitSel: 'h1', selectors: ['h1', '.pageTitle'],
    },
  ];

  const report = [];
  for (const s of scenarios) {
    try {
      report.push(await scenario(s.name, s));
      console.log(`✓ ${s.name}`);
    } catch (e) {
      report.push({ name: s.name, fatal: String(e).slice(0, 300) });
      console.log(`✗ ${s.name}: ${e}`);
    }
  }

  writeFileSync(path.join(OUT_DIR, 'audit-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nRapport: ${OUT_DIR}/audit-report.json`);
  chrome.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
