/** Credential engine: mock NFC cards, OTPs, receipt QR tokens and access codes. Simulation only, not production security. */
export interface Cred { cardId?: string; qrToken?: string; accessCode?: string; phone?: string; issuedAt: number }
type R<T> = Record<number, T>;

const CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pick = (n: number) => Array.from({ length: n }, () => CH[Math.floor(Math.random() * CH.length)]).join('');
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

export const genCardId = () => 'HL-' + Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
export const genTxnId = () => 'TX-' + pick(8);
export const genToken = () => pick(16);
export const genAccessCode = () => digits(6); // long-lived (receipt)
export const genOtp = () => digits(6); // short-lived (SMS)
/** QR content is an opaque local token. Never put personal data in it. */
export const qrPayload = (token: string) => `hl2:${token}`;
export const parseQr = (p: string) => (p.startsWith('hl2:') ? p.slice(4) : null);

function find<T>(r: R<T>, f: (x: T) => boolean): number | null {
  const e = Object.entries(r).find(([, v]) => f(v));
  return e ? Number(e[0]) : null;
}
export const matchCard = <T extends Cred>(r: R<T>, id: string) => (id.trim() ? find(r, (x) => x.cardId === id.trim().toUpperCase()) : null);
export const matchQr = <T extends Cred>(r: R<T>, payload: string) => { const t = parseQr(payload.trim()); return t ? find(r, (x) => x.qrToken === t) : null; };
export function matchCode<T extends Cred>(r: R<T>, code: string, now: number, ttlMs: number): { locker?: number; error?: 'unknown' | 'expired' } {
  const c = code.replace(/\s/g, '');
  const l = c ? find(r, (x) => x.accessCode === c) : null;
  if (l === null) return { error: 'unknown' };
  return now - r[l].issuedAt > ttlMs ? { error: 'expired' } : { locker: l };
}

export interface Otp { code: string; expiresAt: number; attempts: number }
export const newOtp = (now: number, ttlMs: number): Otp => ({ code: genOtp(), expiresAt: now + ttlMs, attempts: 0 });
export function checkOtp<T extends Otp>(o: T | null, input: string, now: number, max: number): { ok: boolean; otp: T | null; error?: 'none' | 'expired' | 'locked' | 'wrong' } {
  if (!o) return { ok: false, otp: null, error: 'none' };
  if (now > o.expiresAt) return { ok: false, otp: o, error: 'expired' };
  if (o.attempts >= max) return { ok: false, otp: o, error: 'locked' };
  if (input.replace(/\s/g, '') === o.code) return { ok: true, otp: null };
  const n = { ...o, attempts: o.attempts + 1 };
  return { ok: false, otp: n, error: n.attempts >= max ? 'locked' : 'wrong' };
}
