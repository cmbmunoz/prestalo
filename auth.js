// Autenticación: hash de contraseña (scrypt, sin dependencias) + token HMAC
const crypto = require('crypto');

const SECRET = process.env.PRESTALO_SECRET || 'prestalo-dev-secret-cambiar-en-produccion';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${dk}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, dk] = stored.split('$');
  const test = crypto.scryptSync(password, salt, 32).toString('hex');
  const a = Buffer.from(dk, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
