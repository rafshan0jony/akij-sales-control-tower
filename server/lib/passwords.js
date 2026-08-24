'use strict';

const crypto = require('node:crypto');

const KEYLEN = 64;
const ITERATIONS = 16384;

/**
 * Hash a password using scrypt (built-in, no native deps).
 * Returns "scrypt$N$salt$hash" for future-proofing.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, { N: ITERATIONS }).toString('hex');
  return `scrypt$${ITERATIONS}$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, iterations, salt, hash] = parts;
  try {
    const derived = crypto.scryptSync(String(password), salt, KEYLEN, { N: parseInt(iterations, 10) });
    const derivedHex = derived.toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derivedHex), Buffer.from(hash));
  } catch (_) {
    return false;
  }
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPassword, verifyPassword, generateResetToken };
