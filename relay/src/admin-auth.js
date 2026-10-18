import config from './admin-hashes.js';
export async function verifyAdmin(code, cfg = config, now = Date.now()) {
  if (typeof code !== 'string' || code.length > 32) return false;
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length !== 8) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(normalized), 'PBKDF2', false, ['deriveBits']);
  for (const offset of [0, -1]) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now + offset * 86400000));
    if (!cfg.days[day]) continue;
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('tianque-admin|' + day), iterations: cfg.iter }, key, 256);
    const hash = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash === cfg.days[day]) return true;
  }
  return false;
}
