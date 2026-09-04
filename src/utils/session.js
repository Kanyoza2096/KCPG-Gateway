'use strict';

const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = 'kdo_kcpg_session';
const KEY = crypto.createHash('sha256').update(config.auth.jwtSecret).digest();
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

function seal(token, expiresAt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.from(JSON.stringify({ token, expiresAt }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function open(value) {
  try {
    const raw = Buffer.from(value, 'base64url');
    if (raw.length < 28) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    if (!data?.token || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) return null;
    return data.token;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const item = part.trim();
    if (!item) continue;
    const i = item.indexOf('=');
    if (i < 0) continue;
    try {
      result[decodeURIComponent(item.slice(0, i))] = decodeURIComponent(item.slice(i + 1));
    } catch { /* ignore malformed cookie */ }
  }
  return result;
}

function cookieAttributes(maxAge) {
  const sameSite = config.cookie.sameSite === 'none' ? 'None' : config.cookie.sameSite === 'strict' ? 'Strict' : 'Lax';
  const secure = config.isProd || sameSite === 'None' ? '; Secure' : '';
  return `Path=/; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}; HttpOnly; SameSite=${sameSite}${secure}`;
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(payload.exp)) return Math.max(0, payload.exp * 1000);
  } catch {}
  return Date.now() + DEFAULT_TTL_MS;
}

function set(res, token) {
  const expiresAt = Math.min(Date.now() + DEFAULT_TTL_MS, tokenExpiry(token));
  const ttl = expiresAt - Date.now();
  if (ttl <= 0) throw new Error('Credential already expired');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(seal(token, expiresAt))}; ${cookieAttributes(ttl)}`);
}

function clear(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieAttributes(0)}`);
}

function fromRequest(req) {
  return open(parseCookies(req.headers?.cookie)[COOKIE_NAME]);
}

module.exports = { COOKIE_NAME, set, clear, fromRequest };
