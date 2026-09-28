'use strict';
/* Staff logins: scrypt password hashes, random session tokens (only their hash is stored). */
const crypto = require('node:crypto');
const { db, log } = require('./db');

const SESSION_HOURS = 12;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)').run(sha(token), userId, Date.now() + SESSION_HOURS * 3600e3);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return token;
}
function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha(token), Date.now());
  return row || null;
}
const endSession = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));

// Simple brake on password guessing: 8 failed tries per email per 15 minutes.
const fails = new Map();
function login(email, pw) {
  email = String(email || '').trim().toLowerCase();
  const f = fails.get(email) || { n: 0, until: 0 };
  if (f.n >= 8 && Date.now() < f.until) throw new Error('Too many attempts. Try again in 15 minutes.');
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!u || !checkPassword(pw, u.pass_hash)) {
    fails.set(email, { n: f.n + 1, until: Date.now() + 15 * 60e3 });
    log(email, 'Login failed');
    throw new Error('Wrong email or password.');
  }
  fails.delete(email);
  log(u.email, 'Logged in');
  return { user: u, token: createSession(u.id) };
}

/** First start: create the admin from ADMIN_EMAIL (+ ADMIN_PASSWORD, or a random one printed to the logs). */
function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const email = String(process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO users(email, name, pass_hash, role) VALUES(?, 'Admin', ?, 'admin')").run(email, hashPassword(pw));
  console.log(`\n=== First admin created: ${email}` + (process.env.ADMIN_PASSWORD ? ' (password from ADMIN_PASSWORD)' : ` / password: ${pw}`) + ' — change it after logging in ===\n');
}

module.exports = { hashPassword, checkPassword, login, userFromToken, endSession, ensureAdmin };
