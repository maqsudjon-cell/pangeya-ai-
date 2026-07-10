// POST /api/auth/register — {first_name, last_name, phone, password}
// Creates an FS Account, returns { token, user }.
import bcrypt from 'bcryptjs';
import {
  applyCors, normalizePhone, PHONE_ERROR,
  signToken, publicUser, sbInsertUser, sbSelectUserByPhone,
} from './_utils.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { first_name, last_name, phone, password } = req.body || {};

    const fn = String(first_name || '').trim();
    const ln = String(last_name || '').trim();
    if (!fn || !ln || fn.length > 100 || ln.length > 100) {
      return res.status(400).json({ error: 'Enter your first and last name.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const e164 = normalizePhone(String(phone || ''));
    if (!e164) {
      return res.status(400).json({ error: PHONE_ERROR });
    }

    const existing = await sbSelectUserByPhone(e164);
    if (existing) {
      return res.status(409).json({ error: 'This phone number is already registered — log in instead.' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const ins = await sbInsertUser({ first_name: fn, last_name: ln, phone: e164, password_hash });
    if (ins.conflict) {
      return res.status(409).json({ error: 'This phone number is already registered — log in instead.' });
    }

    const user = publicUser(ins.user);
    return res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('register error:', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}
