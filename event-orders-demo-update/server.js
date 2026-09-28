'use strict';
/*
 * Event Orders — QR-code ordering for events.
 * Customer page at "/", staff at "/staff", Stripe webhook at "/stripe/webhook".
 * Zero dependencies: Node 22 + built-in SQLite on the Railway volume.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, getSetting, log, seedIfEmpty } = require('./lib/db');
const auth = require('./lib/auth');
const orders = require('./lib/orders');
const staff = require('./lib/staff');
const stripe = require('./lib/stripe');

seedIfEmpty();
auth.ensureAdmin();

const PORT = Number(process.env.PORT) || 3000;
const PAGE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const secureCookies = process.env.NODE_ENV !== 'development';
/** DEMO_MODE=true: shows a "demo" banner everywhere and refuses live Stripe keys, so no real money can ever be taken. */
const DEMO = /^(1|true|yes)$/i.test(process.env.DEMO_MODE || '');
const DEMO_BANNER = `<div role="note" style="position:sticky;top:0;z-index:50;background:#FFF4E5;color:#8A4B00;border-bottom:2px solid #F0A500;
  font:600 14px/1.4 system-ui,sans-serif;text-align:center;padding:8px 12px">DEMO – no real orders and no real payments.
  Pay with test card 4242 4242 4242 4242, any future date, any CVC.</div>`;

/* ---------- small helpers ---------- */
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000', ...extra
  });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
const redirect = (res, to, extra = {}) => { res.writeHead(303, { Location: to, ...extra }); res.end(); };
const withMsg = (to, key, msg) => to + (to.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg);
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
}
function readBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseForm(raw) { return Object.fromEntries(new URLSearchParams(raw)); }
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// Simple rate limit for creating orders: 20 per 10 minutes per IP.
const hits = new Map();
function rateLimited(key, max = 20, windowMs = 600e3) {
  const t = Date.now(), h = (hits.get(key) || []).filter(x => t - x < windowMs);
  h.push(t); hits.set(key, h);
  return h.length > max;
}

/* ---------- customer page ---------- */
function orderPage(req, url) {
  const code = String(url.searchParams.get('event') || getSetting('CURRENT_EVENT') || '').toUpperCase();
  const e = orders.getEvent(code);
  const b = baseUrl(req);
  const boot = { demo: false, closed: false, config: {}, products: [], returnInfo: null, appUrl: b + '/', staffUrl: b + '/staff' };
  if (!e || !e.active) {
    boot.closed = true;
    boot.config = { title1: process.env.COMPANY_NAME || 'Event orders', title2: 'Ordering is closed' };
  } else {
    boot.config = orders.publicConfig(e);
    boot.products = orders.productsWithStock(e.code).map(({ priceCents, sku, ...p }) => p);
  }
  const ref = url.searchParams.get('order'), result = url.searchParams.get('result');
  if (ref && (result === 'paid' || result === 'cancel')) boot.returnInfo = { orderRef: ref, result };
  const html = PAGE.replace('<?!= bootJson ?>', JSON.stringify(boot).replace(/</g, '\\u003c'));
  return DEMO ? html.replace('<body>', '<body>' + DEMO_BANNER) : html;
}

/* ---------- staff routing ---------- */
async function staffRoute(req, res, url) {
  const p = url.pathname, q = Object.fromEntries(url.searchParams);
  const ck = cookies(req);
  const noStore = { 'Cache-Control': 'no-store' };

  if (req.method === 'POST') {
    // Forms must come from this site (stops other websites submitting forms as a logged-in staff member).
    const origin = req.headers.origin;
    if (origin && origin !== baseUrl(req) && new URL(origin).host !== req.headers.host) return send(res, 403, 'Forbidden');
  }
  if (p === '/staff/login') {
    if (req.method === 'GET') return send(res, 200, staff.loginPage(), undefined, noStore);
    const b = parseForm(await readBody(req));
    try {
      const { token } = auth.login(b.email, b.password);
      return redirect(res, '/staff', { 'Set-Cookie': `sid=${token}; Path=/staff; HttpOnly; SameSite=Strict; Max-Age=43200${secureCookies ? '; Secure' : ''}` });
    } catch (e) { return send(res, 401, staff.loginPage(e.message), undefined, noStore); }
  }
  const user = auth.userFromToken(ck.sid);
  if (!user) return redirect(res, '/staff/login');
  if (p === '/staff/logout' && req.method === 'POST') {
    auth.endSession(ck.sid);
    return redirect(res, '/staff/login', { 'Set-Cookie': 'sid=; Path=/staff; Max-Age=0' });
  }
  const admin = user.role === 'admin';
  const back = (to, err) => redirect(res, withMsg(to, err ? 'err' : 'ok', err || 'Saved.'));
  let m;
  try {
    if (req.method === 'GET') {
      let html;
      if (p === '/staff' || p === '/staff/') html = staff.ordersPage(user, q);
      else if ((m = p.match(/^\/staff\/order\/([^/]+)$/))) html = staff.orderPage(user, decodeURIComponent(m[1]), q);
      else if (p === '/staff/pickup') html = staff.pickupPage(user, q);
      else if (p === '/staff/events') html = staff.eventsPage(user, q);
      else if ((m = p.match(/^\/staff\/events\/([^/]+)$/))) html = staff.eventForm(user, decodeURIComponent(m[1]), q);
      else if (p === '/staff/products') html = staff.productsPage(user, q);
      else if (p === '/staff/qr') html = staff.qrPage(user, baseUrl(req));
      else if (p === '/staff/account') html = staff.accountPage(user, q);
      else if (p === '/staff/users' && admin) html = staff.usersPage(user, q);
      else if (p === '/staff/activity' && admin) html = staff.activityPage(user);
      else if (p === '/staff/export.csv') {
        log(user.email, 'CSV export', q.event || '', q.status || 'all');
        return send(res, 200, staff.exportCsv(q), 'text/csv; charset=utf-8', { ...noStore, 'Content-Disposition': `attachment; filename="orders-${q.event || 'all'}.csv"` });
      }
      else return send(res, 404, 'Not found');
      return send(res, 200, html, undefined, noStore);
    }
    if (req.method === 'POST') {
      const b = parseForm(await readBody(req));
      if ((m = p.match(/^\/staff\/order\/([^/]+)\/collect$/))) {
        const ref = decodeURIComponent(m[1]);
        try { staff.collect(user, ref); } catch (e) { return back(q.back === 'pickup' ? '/staff/pickup' : `/staff/order/${encodeURIComponent(ref)}`, e.message); }
        return redirect(res, withMsg(q.back === 'pickup' ? '/staff/pickup' : `/staff/order/${encodeURIComponent(ref)}`, 'ok', `${ref} handed over.`));
      }
      if (p === '/staff/events/current') {
        if (!orders.getEvent(b.code)) return back('/staff/events', 'Unknown event.');
        staff.setCurrent(b.code); log(user.email, 'Current event set', b.code);
        return back('/staff/events', null);
      }
      if ((m = p.match(/^\/staff\/events\/([^/]+)$/))) {
        const code = decodeURIComponent(m[1]);
        try { const c = staff.saveEvent(user, code, b); return back(`/staff/events/${encodeURIComponent(c)}`); }
        catch (e) { return back(`/staff/events/${encodeURIComponent(code)}`, e.message); }
      }
      if ((m = p.match(/^\/staff\/products\/(new|\d+)$/))) {
        try { const ev = staff.saveProduct(user, m[1], b); return back(`/staff/products?event=${encodeURIComponent(ev)}`); }
        catch (e) { return back(`/staff/products?event=${encodeURIComponent(b.event || '')}`, e.message); }
      }
      if (p === '/staff/account') {
        try { staff.changePassword(user, b); return back('/staff/account', null); } catch (e) { return back('/staff/account', e.message); }
      }
      if (admin && p === '/staff/users/new') { try { staff.addUser(user, b); return back('/staff/users'); } catch (e) { return back('/staff/users', e.message); } }
      if (admin && (m = p.match(/^\/staff\/users\/(\d+)\/toggle$/))) { try { staff.toggleUser(user, m[1]); return back('/staff/users'); } catch (e) { return back('/staff/users', e.message); } }
    }
    return send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    return send(res, 500, 'Something went wrong: ' + e.message.replace(/</g, '&lt;'));
  }
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, orderPage(req, url), undefined, { 'Cache-Control': 'no-store' });
    if (p === '/healthz') return json(res, 200, { ok: true });
    if (p.startsWith('/staff')) return staffRoute(req, res, url);

    if (req.method === 'POST' && p.startsWith('/api/')) {
      const fn = p.slice(5);
      let arg;
      try { arg = JSON.parse(await readBody(req, 50_000) || '{}').arg; } catch { return json(res, 400, { error: 'Bad request.' }); }
      try {
        if (fn === 'submitOrder') {
          if (rateLimited('order:' + clientIp(req))) return json(res, 429, { error: 'Too many orders from this device. Please wait a few minutes.' });
          return json(res, 200, await orders.submitOrder(arg || {}, baseUrl(req)));
        }
        if (fn === 'checkOrder') return json(res, 200, await orders.checkOrder(arg));
        if (fn === 'resumePayment') return json(res, 200, await orders.resumePayment(arg));
        return json(res, 404, { error: 'Not found.' });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    if (req.method === 'POST' && p === '/stripe/webhook') {
      const raw = await readBody(req, 1_000_000);
      let event;
      try { event = stripe.verifyWebhook(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
      catch (e) { console.warn('Webhook rejected:', e.message); return json(res, 400, { error: 'Invalid signature' }); }
      if (db.prepare('SELECT 1 FROM webhook_events WHERE id = ?').get(event.id)) return json(res, 200, { received: true, duplicate: true });
      const types = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
      if (types.includes(event.type)) {
        let session = event.data.object;
        try { session = await stripe.getSession(session.id); } catch (e) { /* use the webhook copy if Stripe can't be reached */ }
        orders.applySession(session);
      }
      db.prepare('INSERT OR IGNORE INTO webhook_events(id) VALUES(?)').run(event.id);
      return json(res, 200, { received: true });
    }
    return send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Something went wrong.');
  }
});

server.listen(PORT, () => console.log(`Event Orders running on port ${PORT}${DEMO ? ' (DEMO MODE: test payments only)' : ''}`));
setInterval(() => orders.sweep().catch(e => console.error('sweep', e)), 5 * 60e3);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
