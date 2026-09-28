'use strict';
/* Confirmation emails through Resend's web API (Railway blocks plain SMTP on some plans).
   Optional: without RESEND_API_KEY and EMAIL_FROM, no emails are sent and nothing breaks. */
const { db, log } = require('./db');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendConfirmation(ref) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const { money } = require('./orders');
  const o = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref);
  if (!o || o.email_sent_at) return;
  const e = db.prepare('SELECT * FROM events WHERE code = ?').get(o.event_code) || {};
  const items = db.prepare('SELECT * FROM order_items WHERE order_ref = ?').all(ref);
  const seller = process.env.COMPANY_NAME || 'Nordic Health';
  const rows = items.map(i => `<tr><td style="padding:6px 0;border-bottom:1px solid #ECEEF2">${i.qty} × ${esc(i.name)} (${esc(i.size)})</td><td style="text-align:right;border-bottom:1px solid #ECEEF2">${money(i.line_total, o.currency)}</td></tr>`).join('');
  const how = o.fulfilment === 'Shipping'
    ? `<p><b>We will ship your order to:</b><br>${esc(o.name)}<br>${esc(o.address)}<br>${esc(o.postcode)} ${esc(o.city)}<br>${esc(o.country)}</p>`
    : `<p><b>Collect your order at the event.</b><br>${esc(e.pickup_instructions || 'Show this email at our stand.')}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;color:#22405F;max-width:560px">
    <p>Hi ${esc(String(o.name).split(' ')[0])},</p><p>Thank you for your order at ${esc(e.name || o.event_code)}. Your payment has been received.</p>
    <p style="font-size:13px;margin:24px 0 4px">Order number</p>
    <p style="font-size:30px;font-weight:bold;letter-spacing:1px;margin:0 0 24px;color:#1E3A5F">${esc(o.ref)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="font-size:14px">${o.shipping ? 'Shipping: ' + money(o.shipping, o.currency) + '<br>' : ''}<b>Total paid: ${money(o.total, o.currency)}</b></p>
    ${how}<p style="font-size:12px;color:#5B6F86">Questions? Just reply to this email.</p><p>${esc(seller)}</p></div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [o.email], subject: `Your order ${o.ref} is confirmed`, html,
      reply_to: process.env.REPLY_TO_EMAIL || undefined })
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ' ' + (await res.text()).slice(0, 200));
  db.prepare('UPDATE orders SET email_sent_at = ? WHERE ref = ?').run(new Date().toISOString(), ref);
  log('system', 'Confirmation emailed', ref, o.email);
}

module.exports = { sendConfirmation, esc };
