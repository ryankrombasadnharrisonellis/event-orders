'use strict';
/* Orders: prices and stock always come from the database, never from the browser. */
const { db, getSetting, log, tx } = require('./db');
const stripe = require('./stripe');

const STATUS = { pending: 'Pending', paid: 'Paid', expired: 'Expired', check: 'Check' };
const MAX_QTY = 20;
const WINDOW_MIN = () => Math.max(30, Number(process.env.PAYMENT_WINDOW_MINUTES) || 30);
const now = () => new Date().toISOString();

const cents = (n) => Math.round(Number(n) * 100);
const units = (c) => Math.round(Number(c)) / 100;
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
const money = (c, cur) => { const sym = { EUR: '€', GBP: '£', USD: '$' }[cur]; const n = (c / 100).toFixed(2).replace(/\.00$/, ''); return sym ? sym + n : n + ' ' + cur; };

function getEvent(code) {
  if (!code) return null;
  const e = db.prepare('SELECT * FROM events WHERE code = ?').get(String(code).trim().toUpperCase());
  if (!e) return null;
  return { ...e, active: !!e.active, allow_pickup: !!e.allow_pickup, allow_shipping: !!e.allow_shipping,
           shipTo: String(e.ship_to || '').split(/[,\s]+/).filter(Boolean).map(c => c.toUpperCase()) };
}

function publicConfig(e) {
  return {
    event: e.code, eventName: e.name, title1: e.title1, title2: e.title2, country: e.country_label, code: e.code,
    currency: e.currency, allowPickup: e.allow_pickup, pickupInstructions: e.pickup_instructions,
    allowShipping: e.allow_shipping, shippingFee: units(e.shipping_fee), shipTo: e.shipTo, footerNote: e.footer_note,
    sellerName: process.env.COMPANY_NAME || getSetting('COMPANY_NAME', 'Nordic Health'),
    privacyUrl: process.env.PRIVACY_URL || getSetting('PRIVACY_URL', ''), paymentWindow: WINDOW_MIN()
  };
}

/** Stock left = stock − (paid orders + pending orders that have not expired yet). */
function productsWithStock(eventCode) {
  const reserved = {};
  db.prepare(`SELECT i.product_id, SUM(i.qty) q FROM order_items i JOIN orders o ON o.ref = i.order_ref
      WHERE o.event_code = ? AND (o.status IN ('Paid','Check') OR (o.status = 'Pending' AND o.expires_at > ?))
      GROUP BY i.product_id`).all(eventCode, now()).forEach(r => { reserved[r.product_id] = r.q; });
  return db.prepare('SELECT * FROM products WHERE event_code = ? AND active = 1 ORDER BY sort, id').all(eventCode).map(p => ({
    id: String(p.id), sku: p.sku, name: p.name, size: p.size || '', rrp: units(p.rrp), price: units(p.price),
    priceCents: p.price, image: p.image || 'bottle',
    left: p.stock === null || p.stock === undefined ? null : Math.max(0, p.stock - (reserved[p.id] || 0))
  }));
}

function validateCustomer(c = {}) {
  const name = clean(c.name, 100), email = clean(c.email, 120).toLowerCase(), phone = clean(c.phone, 30);
  if (name.length < 2) throw new Error('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Please enter a valid email address.');
  if (phone.replace(/\D/g, '').length < 6) throw new Error('Please enter a valid phone number.');
  if (c.consent !== true) throw new Error('Please tick the consent box.');
  return { name, email, phone };
}
function validateDelivery(d = {}, e) {
  if (d.method === 'pickup') {
    if (!e.allow_pickup) throw new Error('Pickup is not available for this event.');
    return { method: 'Pickup', address: '', postcode: '', city: '', country: '' };
  }
  if (d.method === 'shipping') {
    if (!e.allow_shipping) throw new Error('Shipping is not available for this event.');
    const line1 = clean(d.line1, 120), line2 = clean(d.line2, 120), postcode = clean(d.postcode, 20), city = clean(d.city, 60);
    const country = clean(d.country, 2).toUpperCase();
    if (line1.length < 3) throw new Error('Please enter your street address.');
    if (postcode.length < 3) throw new Error('Please enter your postcode.');
    if (city.length < 2) throw new Error('Please enter your city.');
    if (e.shipTo.length && !e.shipTo.includes(country)) throw new Error('We can only ship to: ' + e.shipTo.join(', ') + '.');
    return { method: 'Shipping', address: line2 ? line1 + ', ' + line2 : line1, postcode, city, country };
  }
  throw new Error('Please choose pickup or shipping.');
}

function nextRef(eventCode) {
  const row = db.prepare('INSERT INTO counters(event_code, n) VALUES(?, 1) ON CONFLICT(event_code) DO UPDATE SET n = n + 1 RETURNING n').get(eventCode);
  const prefix = (process.env.ORDER_PREFIX || getSetting('ORDER_PREFIX', 'NH')).toUpperCase();
  return `${prefix}-${eventCode}-${String(row.n).padStart(4, '0')}`;
}

async function submitOrder(payload, baseUrl) {
  const e = getEvent(payload && payload.event);
  if (!e || !e.active) throw new Error('This event is not taking orders right now.');
  const customer = validateCustomer(payload.customer);
  const delivery = validateDelivery(payload.delivery, e);

  // 1) Check stock and reserve it, all in one transaction.
  const order = tx(() => {
    const byId = Object.fromEntries(productsWithStock(e.code).map(p => [p.id, p]));
    const lines = (Array.isArray(payload.items) ? payload.items.slice(0, 50) : []).map(it => {
      const p = byId[String(it.id)], qty = Math.floor(Number(it.qty));
      if (!p) throw new Error('One of the products is no longer available. Please reload the page.');
      if (!(qty >= 1 && qty <= MAX_QTY)) throw new Error(`Please choose between 1 and ${MAX_QTY} of each product.`);
      if (p.left !== null && qty > p.left) throw new Error(p.left === 0
        ? `${p.name} (${p.size}) has just sold out. Please remove it and try again.`
        : `Only ${p.left} left of ${p.name} (${p.size}). Please lower the quantity.`);
      return { p, qty, lineTotal: p.priceCents * qty };
    });
    if (!lines.length) throw new Error('Your basket is empty.');
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const shipping = delivery.method === 'Shipping' ? e.shipping_fee : 0;
    const ref = nextRef(e.code);
    const expires = new Date(Date.now() + (WINDOW_MIN() * 60 + 90) * 1000);
    db.prepare(`INSERT INTO orders(ref, created_at, event_code, status, name, email, phone, fulfilment, address, postcode, city, country,
      subtotal, shipping, total, currency, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ref, now(), e.code, STATUS.pending, customer.name, customer.email, customer.phone, delivery.method, delivery.address,
      delivery.postcode, delivery.city, delivery.country, subtotal, shipping, subtotal + shipping, e.currency, expires.toISOString());
    const ins = db.prepare('INSERT INTO order_items(order_ref, product_id, sku, name, size, qty, unit_price, line_total) VALUES(?,?,?,?,?,?,?,?)');
    lines.forEach(l => ins.run(ref, Number(l.p.id), l.p.sku, l.p.name, l.p.size, l.qty, l.p.priceCents, l.lineTotal));
    return { ref, lines, subtotal, shipping, total: subtotal + shipping, expires };
  });

  // 2) Ask Stripe for a payment page with the exact total. If that fails, release the stock again.
  try {
    const back = `${baseUrl}/?event=${encodeURIComponent(e.code)}&order=${encodeURIComponent(order.ref)}`;
    const cur = e.currency.toLowerCase();
    const line_items = order.lines.map(l => ({ quantity: l.qty, price_data: { currency: cur, unit_amount: l.p.priceCents, product_data: { name: `${l.p.name} (${l.p.size})` } } }));
    if (order.shipping > 0) line_items.push({ quantity: 1, price_data: { currency: cur, unit_amount: order.shipping, product_data: { name: 'Shipping' } } });
    const session = await stripe.createCheckoutSession({
      mode: 'payment', success_url: back + '&result=paid', cancel_url: back + '&result=cancel',
      client_reference_id: order.ref, customer_email: customer.email, locale: 'auto',
      expires_at: Math.floor(order.expires.getTime() / 1000),
      metadata: { order_ref: order.ref, event: e.code },
      payment_intent_data: { metadata: { order_ref: order.ref }, description: `${order.ref} · ${e.name || e.code}` },
      line_items
    }, order.ref);
    db.prepare('UPDATE orders SET stripe_session = ? WHERE ref = ?').run(session.id, order.ref);
    log('customer', 'Order created', order.ref, `${money(order.total, e.currency)} · ${delivery.method}`);
    return { orderId: order.ref, total: units(order.total), currency: e.currency, payUrl: session.url };
  } catch (err) {
    tx(() => { db.prepare('DELETE FROM order_items WHERE order_ref = ?').run(order.ref); db.prepare('DELETE FROM orders WHERE ref = ?').run(order.ref); });
    console.error('Checkout failed', order.ref, err.message);
    throw new Error('Payment could not be started. Please try again or ask a member of staff.');
  }
}

/** Applies a Stripe Checkout Session to its order. Safe to call many times (webhook, return page, sweep). */
function applySession(session) {
  const ref = session.client_reference_id || (session.metadata && session.metadata.order_ref);
  const o = ref && db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
  if (!o || o.status !== STATUS.pending) return o;
  const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
  if (paid) {
    const ok = Number(session.amount_total) === o.total && String(session.currency).toUpperCase() === o.currency;
    const pi = session.payment_intent, charge = pi && typeof pi === 'object' ? pi.latest_charge : null;
    db.prepare('UPDATE orders SET status = ?, paid_at = ?, stripe_payment_intent = ?, payment_method = ?, notes = ? WHERE ref = ? AND status = ?').run(
      ok ? STATUS.paid : STATUS.check, now(), pi && typeof pi === 'object' ? pi.id : (pi || ''),
      charge && charge.payment_method_details ? charge.payment_method_details.type : '',
      ok ? o.notes : `Stripe amount ${session.amount_total} ${session.currency} does not match order total — check in Stripe`, ref, STATUS.pending);
    log('stripe', ok ? 'Paid' : 'Paid – amount mismatch', ref, money(Number(session.amount_total), String(session.currency).toUpperCase()));
    if (ok) require('./email').sendConfirmation(ref).catch(err => log('system', 'Email failed', ref, err.message));
  } else if (session.status === 'expired') {
    db.prepare('UPDATE orders SET status = ? WHERE ref = ? AND status = ?').run(STATUS.expired, ref, STATUS.pending);
    log('stripe', 'Expired', ref, 'Payment window closed');
  }
  return db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
}

async function checkOrder(ref) {
  let o = db.prepare('SELECT * FROM orders WHERE ref = ?').get(String(ref || '').trim().toUpperCase());
  if (!o) return { status: 'NotFound' };
  if (o.status === STATUS.pending && o.stripe_session) o = applySession(await stripe.getSession(o.stripe_session));
  return { status: o.status === STATUS.check ? STATUS.paid : o.status, orderRef: o.ref, total: units(o.total), currency: o.currency, fulfilment: o.fulfilment };
}

async function resumePayment(ref) {
  const o = db.prepare('SELECT * FROM orders WHERE ref = ?').get(String(ref || '').trim().toUpperCase());
  if (!o || o.status !== STATUS.pending || !o.stripe_session) return { payUrl: null };
  const s = await stripe.getSession(o.stripe_session);
  if (s.status === 'open') return { payUrl: s.url };
  applySession(s);
  return { payUrl: null };
}

/** Every few minutes: settle pending orders whose payment window has passed (in case a webhook was missed). */
async function sweep() {
  const stale = db.prepare("SELECT ref, stripe_session FROM orders WHERE status = 'Pending' AND expires_at < ?").all(new Date(Date.now() - 2 * 60e3).toISOString());
  for (const o of stale) {
    try {
      if (o.stripe_session) applySession(await stripe.getSession(o.stripe_session));
      else db.prepare("UPDATE orders SET status = 'Expired' WHERE ref = ? AND status = 'Pending'").run(o.ref);
    } catch (err) { console.error('sweep', o.ref, err.message); }
  }
}

module.exports = { STATUS, getEvent, publicConfig, productsWithStock, submitOrder, applySession, checkOrder, resumePayment, sweep, money, units, cents };
