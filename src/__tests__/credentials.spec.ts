import { describe, it, expect } from 'vitest';
import { matchCard, matchCode, matchQr, qrPayload, parseQr, newOtp, checkOtp, genAccessCode, genOtp, Cred } from '../credentials';

const now = 1_000_000;
const rentals: Record<number, Cred> = {
  0: { cardId: 'HL-AAAA', qrToken: 'TOKEN0', accessCode: '123456', issuedAt: now },
  2: { cardId: 'HL-BBBB', issuedAt: now }, // transaction-only receipt: no QR token, no access code
};

describe('card credentials', () => {
  it('match the right locker, case-insensitively, and reject unknown cards', () => {
    expect(matchCard(rentals, 'hl-bbbb')).toBe(2);
    expect(matchCard(rentals, 'HL-0000')).toBeNull();
    expect(matchCard(rentals, '')).toBeNull();
  });
});
describe('receipt credentials', () => {
  it('QR payload is an opaque token and round-trips', () => {
    const p = qrPayload('TOKEN0');
    expect(p).toBe('hl2:TOKEN0'); expect(parseQr(p)).toBe('TOKEN0'); expect(parseQr('other:TOKEN0')).toBeNull();
    expect(matchQr(rentals, p)).toBe(0); expect(matchQr(rentals, 'hl2:NOPE')).toBeNull();
  });
  it('access code works, expires, and unknown codes fail', () => {
    expect(matchCode(rentals, '123 456', now + 1000, 60_000)).toEqual({ locker: 0 });
    expect(matchCode(rentals, '123456', now + 120_000, 60_000)).toEqual({ error: 'expired' });
    expect(matchCode(rentals, '000000', now, 60_000)).toEqual({ error: 'unknown' });
  });
  it('a transaction-only receipt (no token or code) can never authorize retrieval', () => {
    expect(matchQr({ 2: rentals[2] }, qrPayload('anything'))).toBeNull();
    expect(matchCode({ 2: rentals[2] }, '', now, 60_000)).toEqual({ error: 'unknown' });
  });
  it('generates 6-digit codes', () => { expect(genAccessCode()).toMatch(/^\d{6}$/); expect(genOtp()).toMatch(/^\d{6}$/); });
});
describe('OTP', () => {
  it('accepts the right code once, within its lifetime', () => {
    const o = newOtp(now, 120_000);
    expect(checkOtp(o, o.code, now + 1000, 3).ok).toBe(true);
    expect(checkOtp(o, o.code, now + 121_000, 3)).toMatchObject({ ok: false, error: 'expired' });
  });
  it('counts wrong attempts and locks after the configured maximum', () => {
    let o = newOtp(now, 120_000);
    const bad = o.code === '111111' ? '222222' : '111111';
    let r = checkOtp(o, bad, now, 2); expect(r).toMatchObject({ ok: false, error: 'wrong' }); o = r.otp!;
    r = checkOtp(o, bad, now, 2); expect(r).toMatchObject({ ok: false, error: 'locked' }); o = r.otp!;
    expect(checkOtp(o, o.code, now, 2)).toMatchObject({ ok: false, error: 'locked' }); // even the right code is refused once locked
    expect(checkOtp(null, '123456', now, 2).error).toBe('none');
  });
});
