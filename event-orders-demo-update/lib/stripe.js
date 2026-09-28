'use strict';
/* Stripe over its REST API (no SDK), same approach as the DNA kit app. */
const crypto = require('node:crypto');
const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';

function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out;
}

async function call(method, path, body, idempotencyKey) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Payments are not set up yet (STRIPE_SECRET_KEY is missing).');
  if (/^(1|true|yes)$/i.test(process.env.DEMO_MODE || '') && /^(sk|rk)_live_/.test(key)) {
    throw new Error('This is a demo: it only works with Stripe test keys (sk_test_…). Remove the live key or turn off DEMO_MODE.');
  }
  const headers = { Authorization: 'Bearer ' + key };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: body ? form(body).join('&') : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Stripe: ' + ((data.error && data.error.message) || res.status));
  return data;
}

const createCheckoutSession = (params, idem) => call('POST', '/v1/checkout/sessions', params, idem);
const getSession = (id) => call('GET', '/v1/checkout/sessions/' + encodeURIComponent(id) + '?expand%5B%5D=payment_intent.latest_charge');

/** Checks the Stripe-Signature header (HMAC-SHA256 of "timestamp.body"), 5-minute tolerance. */
function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = String(header || '').split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new Error('Bad signature header');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new Error('Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  const ok = sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('Signature mismatch');
  return JSON.parse(rawBody);
}

module.exports = { createCheckoutSession, getSession, verifyWebhook };
