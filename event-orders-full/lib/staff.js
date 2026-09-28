'use strict';
/* Staff pages (server-rendered): orders, pickup hand-over, events, products, users, QR code, CSV export. */
const { db, getSetting, setSetting, log, tx } = require('./db');
const { hashPassword, checkPassword } = require('./auth');
const { money, units, cents, getEvent } = require('./orders');
const { esc } = require('./email');

const CSS = `
:root{--navy:#1E3A5F;--ink:#22405F;--muted:#5B6F86;--red:#E0482B;--band:#ECEEF2;--ok:#1F7A55;--bg:#F4F5F8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--navy);color:#fff;padding:10px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header b{font-size:17px;margin-right:10px}header a{color:#fff;text-decoration:none;opacity:.85}header a:hover,header a.on{opacity:1;text-decoration:underline}
header .me{margin-left:auto;font-size:13px;opacity:.8}
main{max-width:1200px;margin:22px auto;padding:0 18px}
h1{font-size:22px;color:var(--navy);margin:0 0 14px}h2{font-size:17px;color:var(--navy);margin:24px 0 10px}
.card{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(30,58,95,.1);padding:16px 18px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--band);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--navy);background:#F7F9FC}
td.num,th.num{text-align:right;white-space:nowrap}
.tag{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600}
.Paid{background:#D5F0E3;color:#135C3E}.Pending{background:#FFF4D6;color:#7A5200}.Expired{background:#ECEEF2;color:#5B6F86}.Check{background:#FAD4CC;color:#8E2414}
input,select,textarea{font:inherit;padding:8px 10px;border:1.5px solid #C9D3DE;border-radius:7px;background:#fff;color:var(--ink)}
input:focus,select:focus{outline:2px solid var(--red);outline-offset:1px}
button,.btn{font:inherit;font-weight:600;border:0;border-radius:999px;padding:9px 18px;background:var(--navy);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
.btn.ghost,button.ghost{background:#fff;color:var(--navy);border:1.5px solid var(--navy)}button.red{background:var(--red)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.row label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.stat{background:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 1px 3px rgba(30,58,95,.1)}.stat b{display:block;font-size:24px;color:var(--navy)}
.msg{padding:10px 14px;border-radius:8px;margin-bottom:14px}.msg.ok{background:#D5F0E3}.msg.err{background:#FAD4CC}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.muted{color:var(--muted)}a{color:var(--navy)}.big{font-size:28px;font-weight:700;color:var(--navy);letter-spacing:.02em}
.scan{font-size:20px;padding:12px 14px;width:min(420px,100%)}
@media print{header,.noprint{display:none}}`;

function page(title, user, body, active = '') {
  const nav = [['/staff', 'Orders', 'orders'], ['/staff/pickup', 'Pickup desk', 'pickup'], ['/staff/events', 'Events', 'events'],
    ['/staff/products', 'Products', 'products'], ['/staff/qr', 'QR code', 'qr']]
    .concat(user.role === 'admin' ? [['/staff/users', 'Staff', 'users'], ['/staff/activity', 'Activity', 'activity']] : [])
    .map(([h, t, k]) => `<a href="${h}"${k === active ? ' class="on"' : ''}>${t}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Staff</title><style>${CSS}</style></head><body>
<header><b>Event Orders</b>${/^(1|true|yes)$/i.test(process.env.DEMO_MODE || '') ? '<span style="background:#F0A500;color:#1E3A5F;border-radius:999px;padding:2px 10px;font-weight:700;font-size:12px">DEMO</span>' : ''}${nav}<span class="me">${esc(user.email)} · <a href="/staff/account">Account</a> ·
<form method="post" action="/staff/logout" style="display:inline"><button class="ghost" style="padding:3px 10px;font-size:12px">Log out</button></form></span></header>
<main>${body}</main></body></html>`;
}

const loginPage = (msg = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Staff login</title><style>${CSS} .box{max-width:380px;margin:12vh auto}</style></head><body><main class="box"><div class="card">
<h1>Staff login</h1>${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
<form method="post" action="/staff/login" style="display:grid;gap:12px">
<label>Email<br><input name="email" type="email" autocomplete="username" required style="width:100%"></label>
<label>Password<br><input name="password" type="password" autocomplete="current-password" required style="width:100%"></label>
<button>Log in</button></form></div></main></body></html>`;

const flash = (q) => q.ok ? `<div class="msg ok">${esc(q.ok)}</div>` : q.err ? `<div class="msg err">${esc(q.err)}</div>` : '';
const tag = (s) => `<span class="tag ${esc(s)}">${esc(s)}</span>`;
const dt = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: process.env.TZ_DISPLAY || 'Europe/Copenhagen', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const events = () => db.prepare('SELECT code, name, active FROM events ORDER BY created_at DESC').all();
const eventSelect = (sel, name = 'event', all = true) => `<select name="${name}">${all ? '<option value="">All events</option>' : ''}${events().map(e =>
  `<option value="${esc(e.code)}"${e.code === sel ? ' selected' : ''}>${esc(e.code)}${e.name ? ' – ' + esc(e.name) : ''}</option>`).join('')}</select>`;

/* ---------- Orders ---------- */
function ordersPage(user, q) {
  const ev = q.event !== undefined ? q.event : getSetting('CURRENT_EVENT');
  const where = [], args = [];
  if (ev) { where.push('event_code = ?'); args.push(ev); }
  if (q.status) { where.push('status = ?'); args.push(q.status); }
  if (q.q) { where.push('(ref LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?)'); const l = `%${q.q}%`; args.push(l, l, l, l); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM orders ${w} ORDER BY created_at DESC LIMIT 500`).all(...args);
  const sw = ev ? 'WHERE event_code = ?' : '', sa = ev ? [ev] : [];
  const st = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) t, currency FROM orders ${sw ? sw + " AND" : 'WHERE'} status = 'Paid'`).get(...sa);
  const pend = db.prepare(`SELECT COUNT(*) n FROM orders ${sw ? sw + " AND" : 'WHERE'} status = 'Pending'`).get(...sa).n;
  const toHand = db.prepare(`SELECT COUNT(*) n FROM orders ${sw ? sw + " AND" : 'WHERE'} status = 'Paid' AND fulfilment = 'Pickup' AND collected_at IS NULL`).get(...sa).n;
  const toShip = db.prepare(`SELECT COUNT(*) n FROM orders ${sw ? sw + " AND" : 'WHERE'} status = 'Paid' AND fulfilment = 'Shipping'`).get(...sa).n;
  const qs = new URLSearchParams({ event: ev || '', status: q.status || '' }).toString();
  return page('Orders', user, `${flash(q)}<h1>Orders</h1>
  <div class="stats"><div class="stat"><b>${st.n}</b>paid orders</div><div class="stat"><b>${money(st.t, st.currency || 'EUR')}</b>paid revenue</div>
  <div class="stat"><b>${toHand}</b>pickups to hand over</div><div class="stat"><b>${toShip}</b>to ship</div><div class="stat"><b>${pend}</b>waiting for payment</div></div>
  <form class="card row noprint" method="get"><label>Event${eventSelect(ev)}</label>
  <label>Status<select name="status"><option value="">Any</option>${['Paid', 'Pending', 'Expired', 'Check'].map(s => `<option${s === q.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
  <label>Search<input name="q" value="${esc(q.q || '')}" placeholder="Order no., name, email, phone"></label><button>Show</button>
  <a class="btn ghost" href="/staff/export.csv?${qs}">Download CSV (Excel)</a></form>
  <table><thead><tr><th>Order</th><th>Time</th><th>Name</th><th>Delivery</th><th class="num">Total</th><th>Status</th><th>Collected</th></tr></thead><tbody>
  ${rows.map(o => `<tr><td><a href="/staff/order/${encodeURIComponent(o.ref)}">${esc(o.ref)}</a></td><td>${dt(o.created_at)}</td><td>${esc(o.name)}<div class="muted" style="font-size:12px">${esc(o.email)}</div></td>
  <td>${esc(o.fulfilment)}${o.fulfilment === 'Shipping' ? `<div class="muted" style="font-size:12px">${esc(o.city)}, ${esc(o.country)}</div>` : ''}</td>
  <td class="num">${money(o.total, o.currency)}</td><td>${tag(o.status)}</td><td>${o.collected_at ? '✓ ' + dt(o.collected_at) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No orders yet.</td></tr>'}
  </tbody></table>${rows.length === 500 ? '<p class="muted">Showing the latest 500. Use search or CSV for more.</p>' : ''}`, 'orders');
}

function orderPage(user, ref, q) {
  const o = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
  if (!o) return page('Not found', user, '<h1>Order not found</h1>', 'orders');
  const items = db.prepare('SELECT * FROM order_items WHERE order_ref = ?').all(ref);
  const acts = db.prepare('SELECT * FROM activity WHERE ref = ? ORDER BY id').all(ref);
  const canCollect = o.status === 'Paid' && o.fulfilment === 'Pickup' && !o.collected_at;
  const warn = o.status !== 'Paid' ? `<div class="msg err"><b>Do not hand over.</b> This order is ${esc(o.status)}, not Paid.</div>` : '';
  return page(o.ref, user, `${flash(q)}${warn}<p class="muted">Order</p><div class="big">${esc(o.ref)}</div>
  <div class="grid2" style="margin-top:14px">
   <div class="card"><h2 style="margin-top:0">Customer</h2>${esc(o.name)}<br>${esc(o.email)}<br>${esc(o.phone)}</div>
   <div class="card"><h2 style="margin-top:0">Delivery</h2>${o.fulfilment === 'Shipping' ? `Ship to:<br>${esc(o.address)}<br>${esc(o.postcode)} ${esc(o.city)}<br>${esc(o.country)}` : 'Collect at the event'}
    ${o.collected_at ? `<p><b>✓ Collected</b> ${dt(o.collected_at)} by ${esc(o.collected_by)}</p>` : ''}
    ${canCollect ? `<form method="post" action="/staff/order/${encodeURIComponent(o.ref)}/collect" onsubmit="return confirm('Hand over order ${esc(o.ref)} to ${esc(o.name)}?')"><button class="red">Mark as collected</button></form>` : ''}</div>
   <div class="card"><h2 style="margin-top:0">Payment</h2>${tag(o.status)} ${o.paid_at ? dt(o.paid_at) : ''}<br>
    <span class="muted">Stripe payment ID:</span> ${esc(o.stripe_payment_intent || '–')}<br><span class="muted">Method:</span> ${esc(o.payment_method || '–')}
    ${o.stripe_payment_intent ? `<br><a target="_blank" rel="noopener" href="https://dashboard.stripe.com/${(process.env.STRIPE_SECRET_KEY || '').includes('_test_') ? 'test/' : ''}payments/${encodeURIComponent(o.stripe_payment_intent)}">Open in Stripe</a>` : ''}
    ${o.notes ? `<p class="msg err">${esc(o.notes)}</p>` : ''}</div></div>
  <table><thead><tr><th>Product</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th></tr></thead><tbody>
  ${items.map(i => `<tr><td>${esc(i.name)} (${esc(i.size)})</td><td class="num">${money(i.unit_price, o.currency)}</td><td class="num">${i.qty}</td><td class="num">${money(i.line_total, o.currency)}</td></tr>`).join('')}
  ${o.shipping ? `<tr><td colspan="3">Shipping</td><td class="num">${money(o.shipping, o.currency)}</td></tr>` : ''}
  <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(o.total, o.currency)}</b></td></tr></tbody></table>
  <h2>History</h2><table><tbody>${acts.map(a => `<tr><td>${dt(a.at + 'Z')}</td><td>${esc(a.who)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table>`, 'orders');
}

function collect(user, ref) {
  const r = db.prepare("UPDATE orders SET collected_at = ?, collected_by = ? WHERE ref = ? AND status = 'Paid' AND fulfilment = 'Pickup' AND collected_at IS NULL")
    .run(new Date().toISOString(), user.email, ref);
  if (!r.changes) throw new Error('Could not mark as collected (not paid, not pickup, or already collected).');
  log(user.email, 'Collected', ref);
}

/* ---------- Pickup desk: scan or type an order number ---------- */
function pickupPage(user, q) {
  let result = '';
  if (q.ref) {
    const ref = String(q.ref).trim().toUpperCase();
    const o = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
    if (!o) result = `<div class="msg err">No order <b>${esc(ref)}</b>. Check the number.</div>`;
    else {
      const items = db.prepare('SELECT * FROM order_items WHERE order_ref = ?').all(ref);
      const list = `<ul>${items.map(i => `<li><b>${i.qty} ×</b> ${esc(i.name)} (${esc(i.size)})</li>`).join('')}</ul>`;
      if (o.status !== 'Paid') result = `<div class="msg err"><b>Do not hand over.</b> ${esc(ref)} is ${esc(o.status)}.</div>`;
      else if (o.fulfilment !== 'Pickup') result = `<div class="msg err">${esc(ref)} is a <b>shipping</b> order, not pickup.</div>`;
      else if (o.collected_at) result = `<div class="msg err">${esc(ref)} was <b>already collected</b> ${dt(o.collected_at)} (by ${esc(o.collected_by)}).</div>`;
      else result = `<div class="card"><div class="big">${esc(ref)}</div><p>${esc(o.name)}</p>${list}
        <form method="post" action="/staff/order/${encodeURIComponent(ref)}/collect?back=pickup"><button class="red" style="font-size:18px">✓ Handed over</button></form></div>`;
    }
  }
  return page('Pickup desk', user, `${flash(q)}<h1>Pickup desk</h1>
  <form method="get" class="card row"><label>Scan or type the order number<input class="scan" name="ref" autofocus autocomplete="off" placeholder="NH-DK0926-0001"></label><button>Find</button></form>${result}`, 'pickup');
}

/* ---------- Events ---------- */
const EV_FIELDS = [['code', 'Event code', 'e.g. DK0926'], ['name', 'Event name', ''], ['title1', 'Page title line 1', ''], ['title2', 'Page title line 2', ''],
  ['country_label', 'Country label (footer)', ''], ['currency', 'Currency', 'EUR or DKK'], ['pickup_instructions', 'Pickup instructions', ''],
  ['shipping_fee', 'Shipping fee', 'e.g. 6'], ['ship_to', 'Ship to countries', 'e.g. DK, SE'], ['footer_note', 'Footer note', '']];
function eventsPage(user, q) {
  const cur = getSetting('CURRENT_EVENT');
  const list = db.prepare('SELECT e.*, (SELECT COUNT(*) FROM orders o WHERE o.event_code = e.code AND o.status = \'Paid\') paid FROM events e ORDER BY created_at DESC').all();
  return page('Events', user, `${flash(q)}<h1>Events</h1>
  <div class="card"><p>The QR code always opens the <b>current event</b>: <b>${esc(cur || '(none)')}</b>. Switch it here when the next event starts.</p>
  <form method="post" action="/staff/events/current" class="row"><label>Current event${eventSelect(cur, 'code', false)}</label><button>Set as current</button></form></div>
  <table><thead><tr><th>Code</th><th>Name</th><th>Currency</th><th>Pickup</th><th>Shipping</th><th>Open</th><th class="num">Paid orders</th><th></th></tr></thead><tbody>
  ${list.map(e => `<tr><td><b>${esc(e.code)}</b>${e.code === cur ? ' <span class="tag Paid">current</span>' : ''}</td><td>${esc(e.name)}</td><td>${esc(e.currency)}</td>
  <td>${e.allow_pickup ? '✓' : ''}</td><td>${e.allow_shipping ? '✓ ' + money(e.shipping_fee, e.currency) : ''}</td><td>${e.active ? '✓' : 'closed'}</td><td class="num">${e.paid}</td>
  <td><a href="/staff/events/${encodeURIComponent(e.code)}">Edit</a> · <a href="/staff/products?event=${encodeURIComponent(e.code)}">Products</a></td></tr>`).join('')}</tbody></table>
  <p><a class="btn" href="/staff/events/new">+ New event</a></p>`, 'events');
}
function eventForm(user, code, q) {
  const e = code === 'new' ? { code: '', currency: 'EUR', active: 1, allow_pickup: 1, allow_shipping: 1, shipping_fee: 0 } : db.prepare('SELECT * FROM events WHERE code = ?').get(code);
  if (!e) return page('Not found', user, '<h1>Event not found</h1>', 'events');
  const val = (k) => k === 'shipping_fee' ? units(e[k] || 0) : (e[k] ?? '');
  return page('Event', user, `${flash(q)}<h1>${code === 'new' ? 'New event' : 'Edit ' + esc(e.code)}</h1>
  <form method="post" action="/staff/events/${code === 'new' ? 'new' : encodeURIComponent(e.code)}" class="card" style="display:grid;gap:12px;max-width:640px">
  ${EV_FIELDS.map(([k, label, ph]) => `<label>${label}<br><input name="${k}" value="${esc(val(k))}" placeholder="${esc(ph)}" style="width:100%" ${k === 'code' && code !== 'new' ? 'readonly' : ''}${k === 'code' ? ' required pattern="[A-Za-z0-9-]{2,20}"' : ''}></label>`).join('')}
  <label><input type="checkbox" name="allow_pickup" ${e.allow_pickup ? 'checked' : ''}> Allow pickup at the event</label>
  <label><input type="checkbox" name="allow_shipping" ${e.allow_shipping ? 'checked' : ''}> Allow shipping</label>
  <label><input type="checkbox" name="active" ${e.active ? 'checked' : ''}> Open for orders</label>
  ${code === 'new' ? `<label>Copy products from${eventSelect('', 'copy_from', true).replace('All events', '(start empty)')}</label>` : ''}
  <div><button>Save</button> <a class="btn ghost" href="/staff/events">Cancel</a></div></form>`, 'events');
}
function saveEvent(user, code, b) {
  const isNew = code === 'new';
  const c = String(isNew ? b.code : code).trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(c)) throw new Error('Event code: 2–20 letters, numbers or dashes.');
  const cur = String(b.currency || 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error('Currency must be a 3-letter code like EUR or DKK.');
  const v = [String(b.name || ''), String(b.title1 || ''), String(b.title2 || ''), String(b.country_label || ''), cur,
    b.allow_pickup ? 1 : 0, String(b.pickup_instructions || ''), b.allow_shipping ? 1 : 0, Math.max(0, cents(b.shipping_fee || 0)),
    String(b.ship_to || ''), String(b.footer_note || ''), b.active ? 1 : 0];
  tx(() => {
    if (isNew) {
      if (db.prepare('SELECT 1 FROM events WHERE code = ?').get(c)) throw new Error('That event code already exists.');
      db.prepare(`INSERT INTO events(name, title1, title2, country_label, currency, allow_pickup, pickup_instructions, allow_shipping, shipping_fee, ship_to, footer_note, active, code)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...v, c);
      if (b.copy_from) db.prepare(`INSERT INTO products(event_code, sku, name, size, rrp, price, image, stock, active, sort)
        SELECT ?, sku, name, size, rrp, price, image, stock, active, sort FROM products WHERE event_code = ?`).run(c, String(b.copy_from));
    } else {
      db.prepare(`UPDATE events SET name=?, title1=?, title2=?, country_label=?, currency=?, allow_pickup=?, pickup_instructions=?, allow_shipping=?,
        shipping_fee=?, ship_to=?, footer_note=?, active=? WHERE code=?`).run(...v, c);
    }
  });
  log(user.email, isNew ? 'Event created' : 'Event updated', c);
  return c;
}

/* ---------- Products ---------- */
function productsPage(user, q) {
  const ev = q.event || getSetting('CURRENT_EVENT');
  const e = db.prepare('SELECT * FROM events WHERE code = ?').get(ev);
  const list = db.prepare('SELECT * FROM products WHERE event_code = ? ORDER BY sort, id').all(ev);
  const cur = e ? e.currency : 'EUR';
  const row = (p) => { const f = 'p' + (p ? p.id : 'new'), a = `form="${f}"`; return `<tr>
    <td><input ${a} name="sku" value="${esc(p ? p.sku : '')}" size="7" required></td><td><input ${a} name="name" value="${esc(p ? p.name : '')}" size="28" required></td>
    <td><input ${a} name="size" value="${esc(p ? p.size : '')}" size="9"></td><td><input ${a} name="rrp" value="${p ? units(p.rrp) : ''}" size="6" inputmode="decimal"></td>
    <td><input ${a} name="price" value="${p ? units(p.price) : ''}" size="6" inputmode="decimal" required></td>
    <td><input ${a} name="stock" value="${p && p.stock !== null ? p.stock : ''}" size="4" inputmode="numeric" placeholder="∞"></td>
    <td><input ${a} name="image" value="${esc(p ? p.image || '' : '')}" size="14" placeholder="picture link"></td>
    <td><input ${a} name="sort" value="${p ? p.sort : list.length}" size="3"></td>
    <td><input ${a} type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}></td>
    <td><form id="${f}" method="post" action="/staff/products/${p ? p.id : 'new'}"><input type="hidden" name="event" value="${esc(ev)}"><button>${p ? 'Save' : 'Add'}</button></form></td></tr>`; };
  return page('Products', user, `${flash(q)}<h1>Products</h1>
  <form method="get" class="row card"><label>Event${eventSelect(ev, 'event', false)}</label><button>Show</button></form>
  <p class="muted">Prices in ${esc(cur)}. Leave Stock empty for unlimited. Image: a picture link (https://…) or one of the built-in drawings (bottle, tub, lipo, dropper, kraft, shot-y).</p>
  <div style="overflow-x:auto"><table><thead><tr><th>ID</th><th>Name</th><th>Size</th><th>RRP</th><th>Price</th><th>Stock</th><th>Image</th><th>Order</th><th>On sale</th><th></th></tr></thead>
  <tbody>${list.map(row).join('')}${e ? row(null) : ''}</tbody></table></div>`, 'products');
}
function saveProduct(user, id, b) {
  const ev = String(b.event || '');
  if (!db.prepare('SELECT 1 FROM events WHERE code = ?').get(ev)) throw new Error('Unknown event.');
  const price = cents(b.price), rrp = cents(b.rrp || b.price);
  if (!(price > 0)) throw new Error('Price must be more than 0.');
  const stock = String(b.stock ?? '').trim() === '' ? null : Math.max(0, parseInt(b.stock, 10) || 0);
  const v = [String(b.sku || '').trim().toUpperCase(), String(b.name || '').trim(), String(b.size || '').trim(), rrp, price,
    String(b.image || '').trim() || 'bottle', stock, b.active ? 1 : 0, parseInt(b.sort, 10) || 0];
  if (!v[0] || !v[1]) throw new Error('ID and name are required.');
  try {
    if (id === 'new') db.prepare('INSERT INTO products(sku, name, size, rrp, price, image, stock, active, sort, event_code) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...v, ev);
    else db.prepare('UPDATE products SET sku=?, name=?, size=?, rrp=?, price=?, image=?, stock=?, active=?, sort=? WHERE id=? AND event_code=?').run(...v, Number(id), ev);
  } catch (e) { if (/UNIQUE/.test(e.message)) throw new Error('That product ID is already used in this event.'); throw e; }
  log(user.email, id === 'new' ? 'Product added' : 'Product updated', ev, `${v[0]} ${v[1]} ${money(price, 'EUR').slice(1)}`);
  return ev;
}

/* ---------- QR code ---------- */
function qrPage(user, baseUrl) {
  const cur = getSetting('CURRENT_EVENT');
  return page('QR code', user, `<h1>QR code for the order page</h1><div class="card">
  <p>This QR code always opens the <b>current event</b> (now <b>${esc(cur || '(none)')}</b>). Print it once and reuse it: switch events under <a href="/staff/events">Events</a>.</p>
  <div id="q" style="margin:14px 0"></div><p style="word-break:break-all"><b>${esc(baseUrl)}/</b></p>
  <p class="muted">Right-click the QR code ▸ Save image, to use it in print. For a fixed event, use ${esc(baseUrl)}/?event=CODE.</p></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>new QRCode(document.getElementById('q'),{text:${JSON.stringify(baseUrl + '/')},width:260,height:260,colorDark:'#1E3A5F',correctLevel:QRCode.CorrectLevel.M});</script>`, 'qr');
}

/* ---------- Staff accounts ---------- */
function usersPage(user, q) {
  const list = db.prepare('SELECT * FROM users ORDER BY created_at').all();
  return page('Staff', user, `${flash(q)}<h1>Staff accounts</h1>
  <table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
  ${list.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.active ? '✓' : 'no'}</td>
  <td>${u.id !== user.id ? `<form method="post" action="/staff/users/${u.id}/toggle" style="display:inline"><button class="ghost">${u.active ? 'Deactivate' : 'Activate'}</button></form>` : '(you)'}</td></tr>`).join('')}</tbody></table>
  <h2>Add a staff member</h2><form method="post" action="/staff/users/new" class="card row">
  <label>Email<input name="email" type="email" required></label><label>Name<input name="name"></label>
  <label>Temporary password<input name="password" type="text" minlength="10" required></label>
  <label>Role<select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label><button>Add</button></form>
  <p class="muted">Staff can see orders, hand over pickups and edit events and products. Admins can also manage staff and see the activity log.</p>`, 'users');
}
function addUser(user, b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid email.');
  if (String(b.password || '').length < 10) throw new Error('Password must be at least 10 characters.');
  try { db.prepare('INSERT INTO users(email, name, pass_hash, role) VALUES(?,?,?,?)').run(email, String(b.name || ''), hashPassword(b.password), b.role === 'admin' ? 'admin' : 'staff'); }
  catch (e) { throw new Error('That email already has an account.'); }
  log(user.email, 'Staff added', '', email);
}
function toggleUser(user, id) {
  if (Number(id) === user.id) throw new Error('You cannot deactivate yourself.');
  db.prepare('UPDATE users SET active = 1 - active WHERE id = ?').run(Number(id));
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(id));
  log(user.email, 'Staff activated/deactivated', '', String(id));
}
function accountPage(user, q) {
  return page('Account', user, `${flash(q)}<h1>Your account</h1><form method="post" action="/staff/account" class="card" style="display:grid;gap:12px;max-width:420px">
  <label>Current password<br><input name="current" type="password" required style="width:100%"></label>
  <label>New password (at least 10 characters)<br><input name="password" type="password" minlength="10" required style="width:100%"></label>
  <button>Change password</button></form>`, '');
}
function changePassword(user, b) {
  if (!checkPassword(b.current, user.pass_hash)) throw new Error('Current password is wrong.');
  if (String(b.password || '').length < 10) throw new Error('New password must be at least 10 characters.');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.password), user.id);
  log(user.email, 'Password changed');
}
function activityPage(user) {
  const rows = db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 300').all();
  return page('Activity', user, `<h1>Activity log</h1><table><thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Order/Event</th><th>Detail</th></tr></thead><tbody>
  ${rows.map(a => `<tr><td>${dt(a.at + 'Z')}</td><td>${esc(a.who)}</td><td>${esc(a.action)}</td><td>${a.ref ? `<a href="/staff/order/${encodeURIComponent(a.ref)}">${esc(a.ref)}</a>` : ''}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table>`, 'activity');
}

/* ---------- CSV export (opens in Excel) ---------- */
function exportCsv(q) {
  const where = [], args = [];
  if (q.event) { where.push('event_code = ?'); args.push(q.event); }
  if (q.status) { where.push('status = ?'); args.push(q.status); }
  const rows = db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at`).all(...args);
  const items = db.prepare('SELECT * FROM order_items WHERE order_ref = ?');
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Order Ref', 'Created', 'Event', 'Status', 'Name', 'Email', 'Phone', 'Fulfilment', 'Address', 'Postcode', 'City', 'Country',
    'Items', 'Subtotal', 'Shipping', 'Total', 'Currency', 'Paid At', 'Stripe Payment ID', 'Payment Method', 'Collected At', 'Collected By'];
  const lines = rows.map(o => [o.ref, o.created_at, o.event_code, o.status, o.name, o.email, o.phone, o.fulfilment, o.address, o.postcode, o.city, o.country,
    items.all(o.ref).map(i => `${i.qty} x ${i.name} (${i.size})`).join(' | '), (o.subtotal / 100).toFixed(2), (o.shipping / 100).toFixed(2), (o.total / 100).toFixed(2),
    o.currency, o.paid_at, o.stripe_payment_intent, o.payment_method, o.collected_at, o.collected_by].map(cell).join(';'));
  // Semicolons + BOM: opens correctly in Excel with Danish/European settings.
  return '\uFEFFsep=;\r\n' + [head.join(';')].concat(lines).join('\r\n');
}

module.exports = { loginPage, ordersPage, orderPage, collect, pickupPage, eventsPage, eventForm, saveEvent, productsPage, saveProduct,
  qrPage, usersPage, addUser, toggleUser, accountPage, changePassword, activityPage, exportCsv, setCurrent: (code) => setSetting('CURRENT_EVENT', code) };
