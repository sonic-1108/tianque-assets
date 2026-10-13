// Daily passcode for admin.html. The code for a day is derived from ADMIN_SEED (a GitHub secret) and that day's
// date in Chicago; the page only ever ships slow PBKDF2 hashes of the codes, never the seed or the codes.
//   node tools/admin-codes.mjs            -> prints today's code (used by the daily email workflow)
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ITER = 120000;

/** YYYY-MM-DD in Chicago, `offset` days from now */
export function chicagoDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function codeFor(seed, date) {
  const h = createHmac('sha256', seed).update('tianque-admin|' + date).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA[h[i] % ALPHA.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
export function hashFor(code, date) {
  const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return pbkdf2Sync(norm, 'tianque-admin|' + date, ITER, 32, 'sha256').toString('hex');
}
/** hashes for a window of days around today, for the build to embed */
export function hashTable(seed, back = 3, ahead = 400) {
  const out = {};
  for (let k = -back; k <= ahead; k++) {
    const date = chicagoDate(k);
    out[date] = hashFor(codeFor(seed, date), date);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = process.env.ADMIN_SEED;
  if (!seed) {
    console.error('ADMIN_SEED is not set');
    process.exit(1);
  }
  console.log(codeFor(seed, chicagoDate(0)));
}
