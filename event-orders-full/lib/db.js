'use strict';
/* Database: Node's built-in SQLite, stored on the Railway volume (DATA_DIR, default /data). */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'orders.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS events (
  code TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1,
  title1 TEXT, title2 TEXT, name TEXT, country_label TEXT, currency TEXT NOT NULL DEFAULT 'EUR',
  allow_pickup INTEGER NOT NULL DEFAULT 1, pickup_instructions TEXT,
  allow_shipping INTEGER NOT NULL DEFAULT 1, shipping_fee INTEGER NOT NULL DEFAULT 0,
  ship_to TEXT, footer_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_code TEXT NOT NULL, sku TEXT NOT NULL,
  name TEXT NOT NULL, size TEXT, rrp INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL,
  image TEXT, stock INTEGER, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_code, sku)
);
CREATE TABLE IF NOT EXISTS orders (
  ref TEXT PRIMARY KEY, created_at TEXT NOT NULL, event_code TEXT NOT NULL, status TEXT NOT NULL,
  name TEXT, email TEXT, phone TEXT, fulfilment TEXT, address TEXT, postcode TEXT, city TEXT, country TEXT,
  subtotal INTEGER, shipping INTEGER, total INTEGER, currency TEXT,
  stripe_session TEXT, stripe_payment_intent TEXT, payment_method TEXT, paid_at TEXT, expires_at TEXT,
  collected_at TEXT, collected_by TEXT, email_sent_at TEXT, notes TEXT
);
CREATE INDEX IF NOT EXISTS orders_event ON orders(event_code, status);
CREATE INDEX IF NOT EXISTS orders_session ON orders(stripe_session);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_ref TEXT NOT NULL REFERENCES orders(ref),
  product_id INTEGER, sku TEXT, name TEXT, size TEXT, qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL, line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_order ON order_items(order_ref);
CREATE TABLE IF NOT EXISTS counters (event_code TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT, action TEXT, ref TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
`);

const getSetting = (k, def = '') => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : def; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
const log = (who, action, ref, detail) => db.prepare('INSERT INTO activity(who, action, ref, detail) VALUES(?,?,?,?)').run(who || '', action, ref || '', detail || '');

/** Runs fn inside one transaction (all-or-nothing). */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** First start only: an example event and products, so the page works straight away. */
function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) n FROM events').get().n) return;
  db.prepare(`INSERT INTO events(code, active, title1, title2, name, country_label, currency, allow_pickup, pickup_instructions,
    allow_shipping, shipping_fee, ship_to, footer_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'DK0926', 1, 'Nordic Health Supplements', 'Special Offers!', 'Health Week Copenhagen, September 2026', 'DENMARK', 'EUR',
    1, 'Collect from the Nordic Health stand. Show your order number.', 1, 600, 'DK',
    'Offers only valid for products bought during this event');
  const P = db.prepare('INSERT INTO products(event_code, sku, name, size, rrp, price, image, stock, sort) VALUES(?,?,?,?,?,?,?,?,?)');
  [
    ['BRX-C', 'Broccolox®', '80 caps', 6875, 4800, 'bottle'], ['BRX-P', 'Broccolox®', '80 g powder', 6875, 4800, 'bottle'],
    ['NUX-C', 'Nucleo-X™ +Zn', '60 caps', 4811, 3400, 'bottle'], ['NUX-P', 'Nucleo-X™', '45 g powder', 4811, 3400, 'bottle-s'],
    ['GLY', 'Glycine', '400 g', 3994, 2800, 'tub'], ['GLN', 'L-Glutamine', '300 g', 3744, 2600, 'tub'],
    ['LCR', 'Liposomal Curcumin & Resveratrol', '180 ml', 4460, 3100, 'lipo'], ['LVC', 'Liposomal Vitamin C', '150 ml', 4460, 3100, 'lipo'],
    ['CRE', 'Daily Creatine Mono', '450 g', 5805, 4000, 'tub-t'], ['D3', 'Daily D3', '30 ml', 3725, 2600, 'dropper'],
    ['BBC-P', 'Organic & Grass-fed Bone Broth Collagen', '250 g', 5619, 3900, 'kraft'],
    ['BBC-C', 'Organic & Grass-fed Bone Broth Collagen', '300 caps', 5619, 3900, 'kraft-g'],
    ['BLV', 'Organic & Grass-fed Beef Liver', '200 caps', 5770, 4000, 'kraft-r'],
    ['ORG', 'Organic & Grass-fed Organ Matrix', '200 caps', 6130, 4300, 'kraft-r'],
    ['GTS', 'Ginger & Turmeric Shots', '500 ml', 1700, 1400, 'shot-y'],
    ['GTS-S', 'Ginger & Turmeric Shots with Spirulina', '500 ml', 1700, 1400, 'shot-g']
  ].forEach((r, i) => P.run('DK0926', r[0], r[1], r[2], r[3], r[4], r[5], null, i));
  if (!getSetting('CURRENT_EVENT')) setSetting('CURRENT_EVENT', 'DK0926');
}

module.exports = { db, getSetting, setSetting, log, tx, seedIfEmpty, DATA_DIR };
