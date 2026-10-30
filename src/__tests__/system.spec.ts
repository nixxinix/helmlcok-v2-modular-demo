import { describe, it, expect } from 'vitest';
import { defaults, derive, normalizeStages, validateConfig, checkApply, sanitizeConfig, sanitationAt, mkStage, retrievalMethods, StageCfg } from '../system';

const keys = (s: StageCfg[]) => s.map((x) => x.key);

describe('default configuration', () => {
  it('is valid and keeps the original 1 x 3 cabinet with NFC and 4 sanitation stages', () => {
    const c = defaults(), d = derive(c);
    expect(validateConfig(c).errors).toEqual([]);
    expect(d.total).toBe(3);
    expect(d.lockers.every((l) => l.sanitation)).toBe(true);
    expect(keys(d.stages)).toEqual(['uv', 'fogging', 'ozone', 'airdry']);
    expect(d.methods).toEqual(['nfc']);
  });
});

describe('sanitation sequence is strict: UV-C first, cleaning in the middle, drying last', () => {
  it('re-orders any input into the strict order and always keeps UV-C', () => {
    expect(keys(normalizeStages([mkStage('airdry'), mkStage('ozone'), mkStage('uv'), mkStage('fogging')]))).toEqual(['uv', 'ozone', 'fogging', 'airdry']);
    expect(keys(normalizeStages([mkStage('ozone'), mkStage('heatdry')]))[0]).toBe('uv'); // UV-C cannot be removed
    expect(keys(normalizeStages([mkStage('uv'), mkStage('ozone'), mkStage('ozone'), mkStage('airdry')]))).toEqual(['uv', 'ozone', 'airdry']); // no duplicates
  });
  it('rejects configs without UV-C, with wrong order, without drying, or with bad durations', () => {
    const c = defaults();
    c.stages = [mkStage('fogging'), mkStage('airdry')];
    expect(validateConfig(c).errors.join(' ')).toMatch(/UV-C/);
    c.stages = [mkStage('uv'), mkStage('airdry'), mkStage('ozone')];
    expect(validateConfig(c).errors.join(' ')).toMatch(/Order must be/);
    c.stages = [mkStage('uv'), mkStage('ozone')];
    expect(validateConfig(c).errors.join(' ')).toMatch(/drying/);
    c.stages = [mkStage('uv', 0), mkStage('airdry')];
    expect(validateConfig(c).errors.join(' ')).toMatch(/duration/);
  });
  it('stage count follows the configuration (3 and 5 stages) and durations drive progress', () => {
    const three = normalizeStages([mkStage('uv'), mkStage('ozone'), mkStage('heatdry')]);
    const five = normalizeStages([mkStage('uv'), mkStage('misting'), mkStage('fogging'), mkStage('ozone'), mkStage('airdry')]);
    expect(three).toHaveLength(3); expect(five).toHaveLength(5);
    const st = [mkStage('uv', 2), mkStage('ozone', 6), mkStage('airdry', 2)];
    expect(sanitationAt(0.1, st).index).toBe(0);
    expect(sanitationAt(0.5, st).index).toBe(1);
    expect(sanitationAt(0.95, st).index).toBe(2);
  });
});

describe('locker sections', () => {
  it('adding a section gives 6 lockers; removing returns to 3', () => {
    const c = defaults(); c.sections.push('locker');
    const d = derive(c);
    expect(d.total).toBe(6);
    expect(d.lockers[3].sanitation).toBe(false); // basic section has no sanitation hardware
    c.sections.pop();
    expect(derive(c).total).toBe(3);
  });
  it('sanitation module off turns every section into basic lockers', () => {
    const c = defaults(); c.hardware.sanitation = false;
    expect(derive(c).lockers.some((l) => l.sanitation)).toBe(false);
    expect(derive(c).stages).toEqual([]);
  });
});

describe('retrieval methods', () => {
  it('NFC off + OTP on = OTP only; no method at all is invalid', () => {
    const c = defaults(); c.hardware.nfc = false; c.hardware.otp = true;
    expect(retrievalMethods(c)).toEqual(['otp']);
    c.hardware.otp = false;
    expect(validateConfig(c).errors.join(' ')).toMatch(/retrieval method/);
  });
  it('transaction-only receipts never add a retrieval method', () => {
    const c = defaults(); c.hardware.receiptPrinter = true; c.receipt.type = 'transaction';
    expect(retrievalMethods(c)).toEqual(['nfc']);
  });
  it('retrieval receipt needs QR or access code', () => {
    const c = defaults(); c.hardware.receiptPrinter = true; c.receipt.qr = false; c.receipt.code = false;
    expect(validateConfig(c).errors.join(' ')).toMatch(/QR code, an access code/);
  });
});

describe('applying changes safely', () => {
  const rentals = { 4: { service: 'locker', cardId: 'HL-1' } };
  it('blocks removing a section that holds an active rental', () => {
    const c = defaults(); c.sections = ['sanitation', 'locker'];
    expect(checkApply(c, rentals, 'idle')).toEqual([]);
    c.sections = ['sanitation'];
    expect(checkApply(c, rentals, 'idle').join(' ')).toMatch(/Locker 5/);
  });
  it('blocks changes that would strand a stored helmet, and changes during a session', () => {
    const c = defaults(); c.hardware.nfc = false; c.hardware.otp = true;
    expect(checkApply(c, { 0: { service: 'locker', cardId: 'HL-1' } }, 'idle').join(' ')).toMatch(/could no longer be retrieved/);
    expect(checkApply(defaults(), {}, 'payment').join(' ')).toMatch(/session/);
  });
  it('blocks turning a section with an active sanitation rental into a basic section', () => {
    const c = defaults(); c.sections = ['locker'];
    expect(checkApply(c, { 0: { service: 'sanitize', cardId: 'HL-1' } }, 'idle').join(' ')).toMatch(/sanitation rental/);
  });
});

describe('stored configuration is validated at runtime', () => {
  it('falls back to defaults for garbage or invalid data and repairs a missing UV-C', () => {
    expect(sanitizeConfig('nope')).toEqual(defaults());
    expect(sanitizeConfig({ sections: [] })).toEqual(defaults());
    const repaired = sanitizeConfig({ stages: [{ key: 'ozone', seconds: 5 }, { key: 'airdry', seconds: 3 }] });
    expect(keys(repaired.stages)[0]).toBe('uv');
  });
});
