import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { useConfig, defaults, mkStage, SystemConfig } from '../system';
import { qrPayload } from '../credentials';

const S = () => useStore.getState();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 4000) {
  const t = Date.now();
  while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout waiting for condition; stage=' + S().stage + ' ret=' + S().ret); await sleep(4); }
}
const use = (f: (c: SystemConfig) => void) => { const c = defaults(); f(c); useConfig.setState({ active: c }); };
beforeEach(() => { useConfig.setState({ active: defaults() }); S().reset('idle'); S().setSpeed(60); });

async function payCoins() {
  if (!S().method) S().chooseMethod('coin');
  for (let i = 0; i < 4; i++) { await waitFor(() => !S().coinBusy); S().insertCoin(); }
}
async function startRental(locker: number, service: 'locker' | 'sanitize') {
  S().screenClick(); S().begin(); S().selectLocker(locker); S().selectService(service);
}
async function placeHelmetAndFinish() {
  await waitFor(() => S().helmet === 'offered');
  S().placeHelmet(); S().helmetPlaced();
  await waitFor(() => S().stage === 'idle');
}
const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

describe('journey: default configuration (NFC card)', () => {
  it('rent -> pay -> card -> store -> retrieve with the card; wrong card is rejected', async () => {
    await startRental(0, 'locker');
    expect(S().stage).toBe('payment');
    await payCoins();
    await waitFor(() => S().card === 'out');
    S().collectCard(); S().cardCollected(); S().continueToPlacement();
    const card = S().cardId!;
    await placeHelmetAndFinish();
    expect(S().rentals[0].cardId).toBe(card);

    S().screenClick(); S().startRetrieval();
    expect(S().retMethod).toBe('nfc');
    S().presentCard('HL-0000');
    await waitFor(() => S().ret === 'invalid');
    expect(S().doorOpen[0]).toBe(false); // wrong card never opens the locker
    S().retry(); S().presentCard(card);
    await waitFor(() => S().ret === 'ready');
    expect(S().locker).toBe(0); expect(S().doorOpen[0]).toBe(true);
    S().takeHelmet(); S().helmetRemoved();
    await waitFor(() => S().stage === 'completed');
    expect(Object.keys(S().rentals)).toHaveLength(0);
  });
});

describe('journey: OTP only (no card hardware)', () => {
  it('verifies phone, skips card steps, retrieves with a fresh OTP', async () => {
    use((c) => { c.hardware.nfc = false; c.hardware.otp = true; });
    await startRental(1, 'locker');
    expect(S().stage).toBe('phone');
    S().submitPhone('09170000000');
    expect(S().sms?.text).toContain(S().otp!.code);
    S().submitOtp(wrongOf(S().otp!.code)); expect(S().otpMsg).toMatch(/Incorrect/);
    S().submitOtp(S().otp!.code);
    expect(S().stage).toBe('payment');
    await payCoins();
    await waitFor(() => S().stage === 'placement');
    expect(S().cardId).toBeNull(); // no card was ever issued
    await placeHelmetAndFinish();
    expect(S().rentals[1].cardId).toBeUndefined();

    S().screenClick(); S().startRetrieval();
    expect(S().retMethod).toBe('otp');
    S().submitRetrievalPhone('09170000000');
    expect(S().ret).toBe('otp');
    S().submitRetrievalOtp(wrongOf(S().otp!.code)); expect(S().retMsg).toMatch(/Incorrect/);
    S().submitRetrievalOtp(S().otp!.code);
    await waitFor(() => S().ret === 'ready');
    expect(S().locker).toBe(1);
  });
});

describe('journey: retrieval receipt', () => {
  it('access-code receipt retrieves the right locker and rejects a wrong code', async () => {
    use((c) => { c.hardware.nfc = false; c.hardware.receiptPrinter = true; c.receipt = { type: 'retrieval', qr: false, code: true }; });
    await startRental(2, 'locker'); await payCoins();
    await waitFor(() => S().receipt === 'ready');
    S().collectReceipt(); S().receiptCollected(); S().continueFromReceipt();
    const code = S().accessCode!;
    expect(code).toMatch(/^\d{6}$/);
    await placeHelmetAndFinish();
    S().screenClick(); S().startRetrieval();
    expect(S().retMethod).toBe('code');
    S().submitCode(wrongOf(code)); await waitFor(() => S().ret === 'invalid');
    S().retry(); S().submitCode(code);
    await waitFor(() => S().ret === 'ready'); expect(S().locker).toBe(2);
  });
  it('QR receipt retrieves via the simulated scanner', async () => {
    use((c) => { c.hardware.nfc = false; c.hardware.receiptPrinter = true; c.receipt = { type: 'retrieval', qr: true, code: false }; });
    await startRental(0, 'locker'); await payCoins();
    await waitFor(() => S().receipt === 'ready');
    S().collectReceipt(); S().receiptCollected(); S().continueFromReceipt();
    const tok = S().qrToken!;
    await placeHelmetAndFinish();
    S().screenClick(); S().startRetrieval();
    S().scanReceipt('hl2:UNKNOWN'); await waitFor(() => S().ret === 'invalid');
    S().retry(); S().scanReceipt(qrPayload(tok));
    await waitFor(() => S().ret === 'ready');
  });
  it('a transaction-only receipt is issued but carries no retrieval credential', async () => {
    use((c) => { c.hardware.receiptPrinter = true; c.receipt.type = 'transaction'; });
    await startRental(0, 'locker'); await payCoins();
    await waitFor(() => S().receipt === 'ready');
    expect(S().qrToken).toBeNull(); expect(S().accessCode).toBeNull();
    S().collectReceipt(); S().receiptCollected(); S().continueFromReceipt();
    expect(S().stage).toBe('card'); // NFC still enabled: receipt -> card
    await waitFor(() => S().card === 'out');
    S().collectCard(); S().cardCollected(); S().continueToPlacement();
    await placeHelmetAndFinish();
    S().screenClick(); S().startRetrieval();
    expect(S().retMethod).toBe('nfc'); // the only usable method
  });
});

describe('journey: configurable sanitation', () => {
  it('runs exactly the configured stages in order, then returns home', async () => {
    use((c) => { c.stages = [mkStage('uv', 1), mkStage('misting', 1), mkStage('ozone', 1), mkStage('heatdry', 1)]; });
    await startRental(0, 'sanitize'); await payCoins();   // sanitize costs 30 -> coins are 10,10,5,5
    await waitFor(() => S().card === 'out'); S().collectCard(); S().cardCollected(); S().continueToPlacement();
    await waitFor(() => S().helmet === 'offered'); S().placeHelmet(); S().helmetPlaced();
    await waitFor(() => S().stage === 'sanitation');
    expect(S().sanStages.map((s) => s.key)).toEqual(['uv', 'misting', 'ozone', 'heatdry']);
    await waitFor(() => S().sanitize > 0);
    S().skipSanitation();
    await waitFor(() => S().stage === 'idle');
    expect(S().rentals[0]).toBeDefined();
  });
  it('a basic (Locker Only) section cannot start a sanitation service', async () => {
    use((c) => { c.sections = ['locker']; });
    await startRental(0, 'sanitize');
    expect(S().stage).toBe('service'); expect(S().service).toBeNull();
  });
});

describe('restart', () => {
  it('leaves no stale credentials, rentals or timers behind', async () => {
    await startRental(0, 'locker'); await payCoins();
    await waitFor(() => S().card === 'out');
    S().reset('idle');
    await sleep(200);
    expect(S()).toMatchObject({ stage: 'idle', cardId: null, qrToken: null, accessCode: null, card: 'hidden', paid: false, rentals: {} });
  });
});