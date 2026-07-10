// POST /api/auth/login — {phone, password}
// Verifies credentials, returns { token, user }.
// Basic rate limit: max 5 failed attempts per phone per 10 minutes.
import bcrypt from 'bcryptjs';
import {
  applyCors, normalizePhone, PHONE_ERROR,
  signToken, publicUser, sbSelectUserByPhone,
  tooManyFails, recordFail, clearFails,
} from './_utils.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { phone, password } = req.body || {};
    const e164 = normalizePhone(String(phone || ''));
    if (!e164) {
      return res.status(400).json({ error: PHONE_ERROR });
    }
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter your password.' });
    }
    if (tooManyFails(e164)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
    }

    const row = await sbSelectUserByPhone(e164);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      recordFail(e164);
      return res.status(401).json({ error: 'Wrong phone number or password.' });
    }

    clearFails(e164);
    const user = publicUser(row);
    return res.status(200).json({ token: signToken(user), user });
  } catch (err) {
    console.error('login error:', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}
