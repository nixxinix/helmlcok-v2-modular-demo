import { create } from 'zustand';
import gsap from 'gsap';
import { CONFIG, coinsOf, priceOf, ServiceKey } from './config';
import { useConfig, derive, sanitationAt, totalSeconds, retrievalPlan, StageCfg, StageKey, RetrievalMethod } from './system';
import * as cred from './credentials';
import { sfx } from './sound';

export type Stage = 'idle' | 'welcome' | 'locker' | 'service' | 'phone' | 'payment' | 'receipt' | 'card' | 'placement' | 'sanitation' | 'stored' | 'retrieval' | 'completed';
export type Service = ServiceKey;
export type Method = 'coin' | 'qr';
export type HelmetState = 'hidden' | 'offered' | 'placing' | 'inside' | 'removing' | 'gone';
export type CardState = 'hidden' | 'out' | 'collecting' | 'collected';
export type ReceiptState = 'hidden' | 'printing' | 'ready' | 'collecting' | 'collected';
export type Ret = 'choose' | 'prompt' | 'pick' | 'otp' | 'validating' | 'invalid' | 'valid' | 'opening' | 'ready' | 'taking' | 'done';
export type Qr = 'show' | 'phone' | 'scanning' | 'processing' | 'receipt' | 'done';
export type OtpState = cred.Otp & { purpose: 'verify' | 'retrieve' };
export interface Rental extends cred.Cred { txnId: string; service: Service; amount: number; payMethod: Method }

const T = CONFIG.timing;
const ms = (s: number) => s * 1000;
const MAX_LOCKERS = 12;
let timers: number[] = [];
let ticker: number | undefined;
let session = 0;
let speedMul = 1;
function later(fn: () => void, delay: number) {
  const s = session;
  timers.push(window.setTimeout(() => { if (s === session) fn(); }, delay / speedMul));
}
function clearAll() {
  session++;
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
  if (ticker !== undefined) window.clearInterval(ticker);
  ticker = undefined;
  sfx.ambient(null);
}
export const balanceAfter = (n: number, service: Service | null) => coinsOf(service).slice(0, n).reduce((a, b) => a + b, 0);
const ambientKind: Record<StageKey, string> = { uv: 'uv', ozone: 'ozone', misting: 'mist', fogging: 'fog', airdry: 'air', heatdry: 'dry' };
const cfg = () => useConfig.getState().active;
const smsText = (code: string, ttl: number) => `HelmLock V2 (DEMO) code: ${code}. Valid for ${ttl}s. This is a simulated SMS.`;

/** Everything belonging to the current (in-progress) transaction. Rentals live outside so they survive a return to the home screen. */
const txFresh = () => ({
  stage: 'idle' as Stage, locker: null as number | null, service: null as Service | null, method: null as Method | null,
  coins: 0, coinBusy: false, paid: false, qr: 'show' as Qr, wallet: CONFIG.wallets[0].id, qrRef: null as string | null, qrAt: null as number | null,
  txnId: null as string | null, paidAt: null as number | null,
  phone: null as string | null, phoneStep: 'enter' as 'enter' | 'confirm' | 'otp', otp: null as OtpState | null, sms: null as { text: string; at: number } | null, otpMsg: null as string | null,
  receipt: 'hidden' as ReceiptState, qrToken: null as string | null, accessCode: null as string | null,
  cardId: null as string | null, card: 'hidden' as CardState, doorOpen: Array<boolean>(MAX_LOCKERS).fill(false), helmet: 'hidden' as HelmetState,
  sanitize: 0, sanStages: [] as StageCfg[],
  ret: 'prompt' as Ret, retMethod: null as RetrievalMethod | null, retLocker: null as number | null, retMsg: null as string | null, retEmergency: false, retPick: [] as number[],
  warning: false, hover: null as number | null,
});

interface Actions {
  reset: (stage?: Stage, replay?: boolean) => void; home: (stage?: Stage) => void;
  screenClick: () => void; begin: () => void; back: () => void;
  selectLocker: (i: number) => void; selectService: (s: Service) => void;
  submitPhone: (raw: string) => void; confirmPhone: () => void; editPhone: () => void; submitOtp: (code: string) => void; resendOtp: () => void; dismissSms: () => void;
  chooseMethod: (m: Method) => void; setWallet: (id: string) => void; scanQr: () => void; finishQr: () => void;
  insertCoin: () => void; completePayment: () => void;
  collectReceipt: () => void; receiptCollected: () => void; continueFromReceipt: () => void;
  collectCard: () => void; cardCollected: () => void; continueToPlacement: () => void;
  placeHelmet: () => void; helmetPlaced: () => void; finishStorage: () => void;
  startRetrieval: () => void; startEmergency: () => void; submitRetrievalPhone: (raw: string) => void; pickRetrievalLocker: (l: number) => void; chooseRetMethod: (m: RetrievalMethod) => void; presentCard: (id: string) => void;
  submitCode: (code: string) => void; scanReceipt: (payload: string) => void;
  submitRetrievalOtp: (code: string) => void; retry: () => void;
  takeHelmet: () => void; helmetRemoved: () => void; doorClick: (i: number) => void; setHover: (i: number | null) => void;
  toggleHotspots: () => void; setSpeed: (v: number) => void; skipSanitation: () => void;
}
export type State = ReturnType<typeof txFresh> & { rentals: Record<number, Rental>; intro: number; shake: { locker: number; n: number }; hotspots: boolean; speed: number } & Actions;

export const useStore = create<State>((set, get) => {
  const door = (i: number, v: boolean) => get().doorOpen.map((d, k) => (k === i ? v : d));
  const setDoor = (i: number, v: boolean) => { set({ doorOpen: door(i, v) }); if (v) sfx.doorOpen(); else sfx.doorClose(); };
  const otpFail = (r: ReturnType<typeof cred.checkOtp>) => {
    const left = cfg().otp.maxAttempts - (r.otp?.attempts ?? 0);
    return r.error === 'expired' ? 'Code expired. Request a new code.' : r.error === 'locked' ? 'Too many attempts. Request a new code.' : r.error === 'none' ? 'Request a code first.' : `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`;
  };

  /* ----- post-payment pipeline: [receipt] -> [card] -> placement, driven by the active configuration ----- */
  const enterPlacement = () => {
    const l = get().locker; if (l === null) return;
    set({ stage: 'placement' });
    later(() => setDoor(l, true), ms(T.camera));
    later(() => { set({ helmet: 'offered' }); sfx.pop(); }, ms(T.camera + T.door));
  };
  const enterCard = () => { set({ stage: 'card' }); later(() => { set({ card: 'out' }); sfx.dispense(); }, ms(T.camera) * 0.8); };
  const enterReceipt = () => {
    set({ stage: 'receipt' });
    later(() => { set({ receipt: 'printing' }); sfx.print(); }, ms(T.camera) * 0.8);
    later(() => set({ receipt: 'ready' }), ms(T.camera) * 0.8 + T.printMs);
  };
  const enterAfterPayment = () => { const c = cfg(); if (c.hardware.receiptPrinter) enterReceipt(); else if (c.hardware.nfc) enterCard(); else enterPlacement(); };
  const toPayment = () => {
    set({ stage: 'payment' });
    const opts = derive(cfg()).payMethods;
    if (opts.length === 1) set({ method: opts[0], coins: 0, qr: 'show' });
  };

  /* ----- retrieval ----- */
  const openFor = (l: number) => {
    const r = get().rentals[l]; if (!r) return;
    set({ ret: 'valid', locker: l, service: r.service, helmet: 'inside', retMsg: null });
    sfx.success();
    later(() => set({ ret: 'opening' }), 900);
    later(() => setDoor(l, true), 900 + ms(T.camera));
    later(() => set({ ret: 'ready' }), 900 + ms(T.camera + T.door));
  };
  const runRetrieval = (check: () => { locker?: number; error?: string }) => {
    const s = get();
    if (s.stage !== 'retrieval' || !['prompt', 'invalid', 'otp'].includes(s.ret)) return;
    set({ ret: 'validating', retMsg: null });
    later(() => {
      const r = check();
      if (r.locker === undefined) { set({ ret: 'invalid', retMsg: r.error ?? 'Credential not recognized.' }); sfx.error(); } else openFor(r.locker);
    }, T.validateMs);
  };
  /** Retrieval methods per tier (from retrievalPlan), limited to methods that at least one stored rental holds a credential for. */
  const planAvail = () => {
    const rs = Object.values(get().rentals), plan = retrievalPlan(cfg());
    const f = (l: RetrievalMethod[]) => l.filter((m) => rs.some((r) => cred.hasCred(m, r)));
    return { primary: f(plan.primary), emergency: f(plan.emergency) };
  };
  const retReset = { retLocker: null, otp: null, sms: null, retMsg: null, retPick: [] as number[] };
  const enterList = (list: RetrievalMethod[], emergency: boolean) =>
    set({ retEmergency: emergency, retMethod: list.length === 1 ? list[0] : null, ret: list.length === 1 ? 'prompt' : 'choose', ...retReset });
  const enterPrimary = () => {
    const a = planAvail();
    if (a.primary.length) enterList(a.primary, false);
    else if (a.emergency.length) enterList(a.emergency, true); // stored helmets hold no primary credential: go straight to the fallback
    else set({ ret: 'invalid', retMethod: null, retMsg: 'No enabled retrieval method matches the stored helmets.' });
  };
  const leaveRetrieval = () => set({ stage: 'welcome', ret: 'prompt', retMethod: null, retEmergency: false, ...retReset });
  const sendRetrievalOtp = (l: number) => {
    const ttl = cfg().otp.ttlSeconds, o = cred.newOtp(Date.now(), ttl * 1000);
    set({ retLocker: l, ret: 'otp', otp: { ...o, purpose: 'retrieve' }, retMsg: null, retPick: [], sms: { text: smsText(o.code, ttl), at: Date.now() } }); sfx.sms();
  };

  return {
    ...txFresh(), rentals: {}, intro: 0, shake: { locker: -1, n: 0 }, hotspots: false, speed: 1,
    /** Full restart: clears the transaction AND every rental. */
    reset: (stage = 'idle', replay = false) => { clearAll(); set({ ...txFresh(), stage, rentals: {}, intro: get().intro + (replay ? 1 : 0) }); },
    /** Back to the home screen: clears the transaction but keeps stored helmets (red lockers). */
    home: (stage = 'idle') => { clearAll(); set({ ...txFresh(), stage }); },
    screenClick: () => { if (get().stage === 'idle') { set({ stage: 'welcome' }); sfx.wake(); } },
    begin: () => { const s = get(); if (s.stage === 'welcome' && Object.keys(s.rentals).length < derive(cfg()).total) set({ stage: 'locker' }); },
    back: () => {
      const s = get();
      if (s.stage === 'locker') set({ stage: 'welcome', hover: null });
      else if (s.stage === 'service') set({ stage: 'locker', locker: null });
      else if (s.stage === 'phone') set({ stage: 'service', service: null, phone: null, otp: null, sms: null, otpMsg: null, phoneStep: 'enter' });
      else if (s.stage === 'payment') {
        if (s.coins > 0 || s.paid || (s.method === 'qr' && s.qr !== 'show')) return;
        const single = derive(cfg()).payMethods.length === 1;
        if (s.method && !single) set({ method: null, qr: 'show' });
        else set({ stage: 'service', service: null, method: null, qr: 'show', phone: null, otp: null, sms: null, phoneStep: 'enter' });
      } else if (s.stage === 'retrieval' && ['choose', 'prompt', 'invalid', 'otp', 'pick'].includes(s.ret)) {
        const av = planAvail(), mine = s.retEmergency ? av.emergency : av.primary;
        if (s.ret !== 'choose' && mine.length > 1) enterList(mine, s.retEmergency); // back to this tier's method list
        else if (s.retEmergency && av.primary.length) enterPrimary(); // back from emergency to the normal method
        else leaveRetrieval();
      }
    },
    selectLocker: (i) => { const s = get(); if (s.stage !== 'locker' || s.rentals[i] || i >= derive(cfg()).total) return; set({ locker: i, stage: 'service', hover: null }); sfx.select(); },
    selectService: (sv) => {
      const s = get(); if (s.stage !== 'service' || s.locker === null) return;
      if (sv === 'sanitize' && !derive(cfg()).lockers[s.locker].sanitation) return; // basic sections have no sanitation hardware
      set({ service: sv }); sfx.select();
      if (cfg().hardware.otp) set({ stage: 'phone', phoneStep: 'enter', otpMsg: null }); else toPayment();
    },
    /* ----- demo phone number + simulated OTP ----- */
    submitPhone: (raw) => {
      if (get().stage !== 'phone') return;
      const digits = cred.cleanPhone(raw); // digits only, max 11 (also covers pasted text)
      if (!cred.isPhone(digits)) { set({ otpMsg: `Enter exactly ${cred.PHONE_DIGITS} digits (numbers only), e.g. 09123456789.` }); sfx.error(); return; }
      const c = cfg();
      if (!c.otp.verify) { set({ phone: digits, phoneStep: 'confirm', otpMsg: null }); sfx.select(); return; } // OTP OFF: no code is sent, just confirm the number
      const ttl = c.otp.ttlSeconds, o = cred.newOtp(Date.now(), ttl * 1000);
      set({ phone: digits, phoneStep: 'otp', otp: { ...o, purpose: 'verify' }, otpMsg: null, sms: { text: smsText(o.code, ttl), at: Date.now() } }); sfx.sms();
    },
    confirmPhone: () => { const s = get(); if (s.stage === 'phone' && s.phoneStep === 'confirm' && s.phone) { sfx.select(); toPayment(); } },
    editPhone: () => { if (get().stage === 'phone') set({ phoneStep: 'enter', phone: null, otpMsg: null }); },
    submitOtp: (input) => {
      const s = get(); if (s.stage !== 'phone' || s.phoneStep !== 'otp') return;
      const r = cred.checkOtp(s.otp, input, Date.now(), cfg().otp.maxAttempts);
      if (r.ok) { set({ otp: null, sms: null, otpMsg: null }); sfx.success(); toPayment(); } else { set({ otp: r.otp, otpMsg: otpFail(r) }); sfx.error(); }
    },
    resendOtp: () => {
      const s = get(), c = cfg(), ttl = c.otp.ttlSeconds, o = cred.newOtp(Date.now(), ttl * 1000);
      if (s.stage === 'phone' && s.phone) set({ otp: { ...o, purpose: 'verify' }, otpMsg: null, sms: { text: smsText(o.code, ttl), at: Date.now() } });
      else if (s.stage === 'retrieval' && s.retLocker !== null) set({ otp: { ...o, purpose: 'retrieve' }, retMsg: null, sms: { text: smsText(o.code, ttl), at: Date.now() } });
      else return;
      sfx.sms();
    },
    dismissSms: () => set({ sms: null }),
    /* ----- payment ----- */
    chooseMethod: (m) => { if (get().stage === 'payment' && !get().method && derive(cfg()).payMethods.includes(m)) set({ method: m, coins: 0, qr: 'show' }); },
    setWallet: (id) => { const s = get(); if (s.method === 'qr' && s.qr === 'show') set({ wallet: id }); },
    /** User clicked the QR: phone arrives, scans, zooms to its screen, shows a receipt, then pays. */
    scanQr: () => {
      const s = get();
      if (s.stage !== 'payment' || s.method !== 'qr' || s.qr !== 'show') return;
      let t = T.qrPhoneMs;
      set({ qr: 'phone' }); sfx.whoosh();
      later(() => { set({ qr: 'scanning' }); sfx.scan(); }, t);
      t += T.qrScanMs; later(() => { set({ qr: 'processing' }); sfx.whoosh(); sfx.processing(); }, t);
      t += T.qrProcessMs;
      later(() => { set({ qr: 'receipt', qrRef: String(Math.floor(Math.random() * 1e12)).padStart(12, '0'), qrAt: Date.now() }); sfx.success(); }, t);
      t += T.receiptAutoMs; later(() => get().finishQr(), t);
    },
    finishQr: () => { if (get().qr !== 'receipt') return; set({ qr: 'done' }); get().completePayment(); },
    insertCoin: () => {
      const s = get();
      if (s.stage !== 'payment' || s.method !== 'coin' || s.coinBusy || s.paid || s.coins >= coinsOf(s.service).length) return;
      const n = s.coins + 1;
      set({ coins: n, coinBusy: true });
      sfx.coinToss(); later(() => sfx.coin(), ms(T.coin) * 0.72);
      later(() => set({ coinBusy: false }), ms(T.coin));
      if (balanceAfter(n, s.service) >= priceOf(s.service)) later(() => get().completePayment(), ms(T.coin) + 300);
    },
    /** Generates only the credentials the active configuration uses (NFC card, receipt QR token, receipt access code). */
    completePayment: () => {
      if (get().paid) return;
      const c = cfg(), rr = c.hardware.receiptPrinter && c.receipt.type === 'retrieval';
      set({
        paid: true, paidAt: Date.now(), txnId: cred.genTxnId(), cardId: c.hardware.nfc ? cred.genCardId() : null,
        qrToken: rr && c.receipt.qr ? cred.genToken() : null, accessCode: rr && c.receipt.code ? cred.genAccessCode() : null,
      });
      sfx.paid();
      later(() => enterAfterPayment(), 1300);
    },
    collectReceipt: () => { if (get().receipt === 'ready') { set({ receipt: 'collecting' }); sfx.cardPick(); } },
    receiptCollected: () => { set({ receipt: 'collected' }); sfx.select(); },
    continueFromReceipt: () => { const s = get(); if (s.stage !== 'receipt' || s.receipt !== 'collected') return; if (cfg().hardware.nfc) enterCard(); else enterPlacement(); },
    collectCard: () => { if (get().card === 'out') { set({ card: 'collecting' }); sfx.cardPick(); } },
    cardCollected: () => { set({ card: 'collected' }); sfx.select(); },
    continueToPlacement: () => { const s = get(); if (s.stage === 'card' && s.card === 'collected') enterPlacement(); },
    placeHelmet: () => { if (get().helmet === 'offered') { set({ helmet: 'placing' }); sfx.whoosh(); } },
    helmetPlaced: () => {
      const s = get(), l = s.locker;
      if (l === null || !s.txnId || !s.service) return;
      const rental: Rental = {
        txnId: s.txnId, service: s.service, amount: priceOf(s.service), payMethod: s.method ?? 'coin', issuedAt: Date.now(),
        cardId: s.cardId ?? undefined, phone: s.phone ?? undefined, qrToken: s.qrToken ?? undefined, accessCode: s.accessCode ?? undefined,
      };
      set({ helmet: 'inside', rentals: { ...s.rentals, [l]: rental } }); sfx.thump();
      later(() => setDoor(l, false), 400);
      later(() => {
        const stages = derive(cfg()).stages;
        if (get().service === 'sanitize' && stages.length) {
          set({ stage: 'sanitation', sanitize: 0, sanStages: stages });
          later(() => {
            const step = 100 / ms(totalSeconds(stages));
            let last = 0; sfx.stageChange(); sfx.ambient(ambientKind[stages[0].key]);
            ticker = window.setInterval(() => {
              const p = get().sanitize + step * speedMul;
              if (p >= 1) {
                window.clearInterval(ticker); ticker = undefined;
                set({ sanitize: 1 }); sfx.ambient(null); sfx.complete();
                later(() => get().finishStorage(), 1100);
              } else {
                set({ sanitize: p });
                const ix = sanitationAt(p, stages).index;
                if (ix !== last) { last = ix; sfx.stageChange(); sfx.ambient(ambientKind[stages[ix].key]); }
              }
            }, 100);
          }, ms(T.camera) * 0.8);
        } else get().finishStorage();
      }, 400 + ms(T.door) + 300);
    },
    /** Helmet is stored: confirm briefly, then return to the home screen (idle) with the locker marked red. */
    finishStorage: () => {
      if (!['placement', 'sanitation'].includes(get().stage)) return;
      set({ stage: 'stored' }); sfx.stored();
      later(() => get().home(), T.storedMs);
    },
    /* ----- retrieval: method availability follows the active configuration ----- */
    startRetrieval: () => {
      const s = get(); if (s.stage !== 'welcome' || !Object.keys(s.rentals).length) return;
      set({ stage: 'retrieval' }); enterPrimary(); // NFC alone when enabled; otherwise the highest-priority configured method(s)
    },
    /** "Card / receipt lost": switch to the emergency method(s) of the active configuration. */
    startEmergency: () => { const av = planAvail(); if (get().stage === 'retrieval' && av.emergency.length) { sfx.select(); enterList(av.emergency, true); } },
    chooseRetMethod: (m) => { if (get().stage === 'retrieval') set({ retMethod: m, ret: 'prompt', ...retReset }); },
    presentCard: (id) => {
      if (!cfg().hardware.nfc || get().retMethod !== 'nfc') return;
      sfx.cardInsert();
      runRetrieval(() => { const l = cred.matchCard(get().rentals, id); return l === null ? { error: 'This card does not match any active rental.' } : { locker: l }; });
    },
    submitCode: (code) => {
      if (get().retMethod !== 'code') return;
      runRetrieval(() => {
        const r = cred.matchCode(get().rentals, code, Date.now(), cfg().codeTtlMinutes * 60000);
        return r.locker !== undefined ? { locker: r.locker } : { error: r.error === 'expired' ? 'This access code has expired.' : 'Access code not recognized.' };
      });
    },
    scanReceipt: (payload) => {
      if (get().retMethod !== 'qr') return;
      sfx.scan();
      runRetrieval(() => { const l = cred.matchQr(get().rentals, payload); return l === null ? { error: 'QR code not recognized.' } : { locker: l }; });
    },
    submitRetrievalPhone: (raw) => {
      const s = get(); if (s.stage !== 'retrieval' || s.retMethod !== 'otp' || s.ret !== 'prompt') return;
      const digits = cred.cleanPhone(raw);
      if (!cred.isPhone(digits)) { set({ retMsg: `Enter exactly ${cred.PHONE_DIGITS} digits (numbers only).` }); sfx.error(); return; }
      const hits = cred.matchPhone(s.rentals, digits);
      if (!hits.length) { set({ ret: 'invalid', retMsg: 'No stored helmet is linked to this number.' }); sfx.error(); return; }
      if (hits.length > 1) { set({ ret: 'pick', retPick: hits, retMsg: null }); return; }
      get().pickRetrievalLocker(hits[0]);
    },
    pickRetrievalLocker: (l) => {
      const s = get(); if (s.stage !== 'retrieval' || s.retMethod !== 'otp' || !s.rentals[l]?.phone) return;
      if (cfg().otp.verify) sendRetrievalOtp(l); // OTP ON: send a fresh code and require it
      else { set({ ret: 'prompt' }); runRetrieval(() => ({ locker: l })); } // OTP OFF: the number on file is the credential
    },
    submitRetrievalOtp: (input) => {
      const s = get(); if (s.stage !== 'retrieval' || s.ret !== 'otp' || s.retLocker === null) return;
      const r = cred.checkOtp(s.otp, input, Date.now(), cfg().otp.maxAttempts), l = s.retLocker;
      if (r.ok) { set({ otp: null, sms: null }); runRetrieval(() => ({ locker: l })); } else { set({ otp: r.otp, retMsg: otpFail(r) }); sfx.error(); }
    },
    retry: () => { if (get().ret === 'invalid') set({ ret: get().retMethod ? 'prompt' : 'choose', retMsg: null }); },
    takeHelmet: () => { const s = get(); if (s.ret === 'ready' && s.helmet === 'inside') { set({ ret: 'taking', helmet: 'removing' }); sfx.whoosh(); } },
    helmetRemoved: () => {
      const s = get(), l = s.locker;
      if (l === null) return;
      const rentals = { ...s.rentals }; delete rentals[l];
      set({ helmet: 'gone', rentals }); sfx.success(); setDoor(l, false);
      later(() => { set({ stage: 'completed', ret: 'done' }); sfx.fanfare(); }, ms(T.door) + 500);
    },
    doorClick: (i) => {
      const s = get();
      if (s.doorOpen[i]) return;
      if (['placement', 'sanitation', 'retrieval'].includes(s.stage) && s.locker === i) return;
      set({ shake: { locker: i, n: s.shake.n + 1 }, warning: true }); sfx.denied();
      later(() => set({ warning: false }), T.warningMs);
    },
    setHover: (i) => { set({ hover: i }); if (i !== null) sfx.tick(); },
    toggleHotspots: () => set({ hotspots: !get().hotspots }),
    setSpeed: (v) => { speedMul = v; gsap.globalTimeline.timeScale(v); set({ speed: v }); },
    skipSanitation: () => { const s = get(); if (s.stage === 'sanitation' && s.sanitize > 0 && s.sanitize < 1) set({ sanitize: 0.9999 }); },
  };
});

/** Which camera view the current state needs. */
export function viewId(s: State): string {
  const L = s.locker ?? 0;
  switch (s.stage) {
    case 'idle': case 'stored': case 'completed': return 'showcase';
    case 'payment': return s.method === 'coin' ? 'coin' : 'screen';
    case 'receipt': return 'receipt';
    case 'card': return 'card';
    case 'placement': return 'locker:' + L;
    case 'sanitation': return 'close:' + L;
    case 'retrieval': return ['opening', 'ready', 'taking', 'done'].includes(s.ret) ? 'locker:' + L : 'screen';
    default: return 'screen';
  }
}
