// FS Account — shared helpers for the auth endpoints.
// Files starting with "_" are not exposed as Vercel functions.
import jwt from 'jsonwebtoken';

export const CORS_ORIGINS = [
  'https://flarestamina.com',
  'https://www.flarestamina.com',
  'https://pangea8.com', // during transition
  'https://www.pangea8.com',
];

export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

/**
 * International phone normalization (NOT Uzbekistan-only).
 *  - strip spaces, dashes, dots, parentheses
 *  - starts with "+"        -> must match E.164  ^\+[1-9]\d{6,14}$
 *  - no "+", starts 998, 12 digits total -> prepend "+"
 *  - no "+", 9-digit Uzbek local mobile  -> prepend "+998"
 *  - anything else -> null (caller returns a clear error)
 * Returns canonical E.164 string or null.
 */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const raw = input.replace(/[\s\-.()]/g, '');
  if (!raw) return null;
  if (raw.startsWith('+')) {
    return /^\+[1-9]\d{6,14}$/.test(raw) ? raw : null;
  }
  if (!/^\d+$/.test(raw)) return null;
  if (raw.startsWith('998') && raw.length === 12) return '+' + raw;
  if (raw.length === 9) return '+998' + raw;
  return null;
}

export const PHONE_ERROR =
  'Include your country code, e.g. +998 90 123 45 67';

export function signToken(user) {
  const secret = process.env.FS_JWT_SECRET;
  if (!secret) throw new Error('FS_JWT_SECRET is not configured');
  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '30d' }
  );
}

export function publicUser(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
  };
}

// --- Supabase (PostgREST) ---------------------------------------------
function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars are not configured');
  return { url: url.replace(/\/$/, ''), key };
}

export async function sbSelectUserByPhone(phone) {
  const { url, key } = sb();
  const r = await fetch(
    `${url}/rest/v1/fs_users?phone=eq.${encodeURIComponent(phone)}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!r.ok) throw new Error(`Supabase select failed: ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function sbInsertUser(row) {
  const { url, key } = sb();
  const r = await fetch(`${url}/rest/v1/fs_users`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (r.status === 409) return { conflict: true };
  if (!r.ok) throw new Error(`Supabase insert failed: ${r.status}`);
  const rows = await r.json();
  return { user: rows[0] };
}

// --- naive per-instance rate limiter (login) ---------------------------
// Serverless caveat: state is per warm instance; good enough as a speed bump.
const fails = new Map(); // phone -> [timestamps]
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;

export function tooManyFails(phone) {
  const now = Date.now();
  const list = (fails.get(phone) || []).filter((t) => now - t < WINDOW_MS);
  fails.set(phone, list);
  return list.length >= MAX_FAILS;
}

export function recordFail(phone) {
  const list = fails.get(phone) || [];
  list.push(Date.now());
  fails.set(phone, list);
}

export function clearFails(phone) {
  fails.delete(phone);
}
