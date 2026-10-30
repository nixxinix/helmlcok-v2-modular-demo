import { ReactNode, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useStore, viewId, balanceAfter, Rental, Stage } from './store';
import { CONFIG, Wallet, priceOf, coinsOf } from './config';
import { useConfig, useDerived, sanitationAt, totalSeconds, METHOD_LABEL, RetrievalMethod } from './system';
import { qrPayload } from './credentials';
import { sfx } from './sound';
import Admin from './Admin';

const peso = (n: number) => `${CONFIG.currency}${n}`;
const money = (n: number) => `${CONFIG.currency}${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (t: number | null) => (t ? new Date(t).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const Btn = ({ children, onClick, ghost, disabled }: { children: ReactNode; onClick: () => void; ghost?: boolean; disabled?: boolean }) => (
  <button className={ghost ? 'btn ghost' : 'btn'} onClick={onClick} disabled={disabled}>{children}</button>
);

/** Brand badge. Set `logo` on a wallet in config.ts to use an official image instead. */
function Logo({ w }: { w: Wallet }) {
  if (w.logo) return <img className="logo-img" src={w.logo} alt={w.name} />;
  return <span className="logo" style={{ background: w.bg, color: w.fg }}>{w.name}</span>;
}

/** Real QR image generated locally from an opaque identifier (never personal data). */
function QrImg({ text, size = 190 }: { text: string; size?: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let on = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#0b1626', light: '#ffffff' } }).then((u) => { if (on) setUrl(u); }).catch(() => undefined);
    return () => { on = false; };
  }, [text, size]);
  return url ? <img className="qr" src={url} width={size} height={size} alt="QR code" /> : <div className="qr" style={{ width: size, height: size }} />;
}

function CodeForm({ label, placeholder, cta, maxLength = 12, onSubmit }: { label: string; placeholder: string; cta: string; maxLength?: number; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form className="codeform" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label>{label}<input autoFocus inputMode="numeric" value={v} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setV(e.target.value)} /></label>
      <button className="btn" type="submit">{cta}</button>
    </form>
  );
}

/** Zoomed phone for QR payment: processing, then a demo receipt showing the deducted amount. */
function PayPhone() {
  const s = useStore();
  const w = CONFIG.wallets.find((x) => x.id === s.wallet) ?? CONFIG.wallets[0];
  const price = priceOf(s.service);
  if (s.method !== 'qr' || (s.qr !== 'processing' && s.qr !== 'receipt')) return null;
  return (
    <div className="zoom" role="dialog" aria-label="Simulated phone payment">
      <div className="bigphone"><div className="notch" />
        <div className="appbar" style={{ background: w.bg, color: w.fg }}>{w.name}</div>
        {s.qr === 'processing' ? (
          <div className="appbody center"><div className="spin" /><h3>Paying HelmLock V2</h3><p>{money(price)}</p><small>Processing payment…</small></div>
        ) : (
          <div className="appbody">
            <div className="rhead"><div className="check">✓</div><h3>Payment Successful</h3><div className="amt">{money(price)}</div></div>
            <dl className="rcpt">
              <dt>Merchant</dt><dd>HelmLock V2 (demo)</dd><dt>Paid via</dt><dd>{w.name}</dd><dt>Reference No.</dt><dd>{s.qrRef}</dd><dt>Date</dt><dd>{when(s.qrAt)}</dd>
              <dt>Balance before</dt><dd>{money(CONFIG.walletBalance)}</dd><dt>Amount deducted</dt><dd className="neg">−{money(price)}</dd>
              <dt>Balance after</dt><dd><b>{money(CONFIG.walletBalance - price)}</b></dd>
            </dl>
            <small>Demo receipt only. No real transaction occurred.</small>
            <button className="btn" onClick={s.finishQr}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Animated demo phone that shows the simulated SMS with the OTP. */
function SmsPhone() {
  const sms = useStore((s) => s.sms);
  const dismiss = useStore((s) => s.dismissSms);
  if (!sms) return null;
  return (
    <div className="sms" role="status" aria-live="polite">
      <div className="smsphone"><div className="notch" />
        <div className="smshead">Messages · SIMULATION</div>
        <div className="bubble">{sms.text}</div>
        <small>Demo only. No real SMS was sent.</small>
        <button className="btn ghost sm" onClick={dismiss}>Close</button>
      </div>
    </div>
  );
}

interface ReceiptData { txnId: string; locker: number; service: string; method: string; amount: number; at: number | null; type: 'transaction' | 'retrieval'; qrToken?: string | null; accessCode?: string | null }
function Receipt({ r }: { r: ReceiptData }) {
  return (
    <div className="paper">
      <b className="ph">HELMLOCK V2</b><small>{r.type === 'retrieval' ? 'RETRIEVAL RECEIPT' : 'TRANSACTION RECEIPT'}</small>
      <dl><dt>Reference</dt><dd>{r.txnId}</dd><dt>Locker</dt><dd>{r.locker + 1}</dd><dt>Service</dt><dd>{r.service}</dd><dt>Payment</dt><dd>{r.method}</dd>
        <dt>Amount</dt><dd>{money(r.amount)}</dd><dt>Date</dt><dd>{when(r.at)}</dd><dt>Status</dt><dd>PAID</dd></dl>
      {r.qrToken && <QrImg text={qrPayload(r.qrToken)} size={120} />}
      {r.accessCode && <div className="acode">Access code <b>{r.accessCode}</b></div>}
      {r.type === 'transaction' && <small>Record only. Not valid for retrieval.</small>}
      <small>Demo receipt. No real transaction.</small>
    </div>
  );
}
const receiptOf = (i: number, r: Rental): ReceiptData => ({
  txnId: r.txnId, locker: i, service: CONFIG.services[r.service].label, method: r.payMethod === 'coin' ? 'Coins' : 'Online QR', amount: r.amount, at: r.issuedAt,
  type: r.qrToken || r.accessCode ? 'retrieval' : 'transaction', qrToken: r.qrToken, accessCode: r.accessCode,
});

function Steps({ stage, service }: { stage: Stage; service: string | null }) {
  const c = useConfig((s) => s.active);
  const list = [{ k: 'locker', l: 'Locker' }, { k: 'service', l: 'Service' }, ...(c.hardware.otp ? [{ k: 'phone', l: 'Verify' }] : []), { k: 'payment', l: 'Payment' },
    ...(c.hardware.receiptPrinter ? [{ k: 'receipt', l: 'Receipt' }] : []), ...(c.hardware.nfc ? [{ k: 'card', l: 'Card' }] : []), { k: 'store', l: 'Store' },
    ...(c.hardware.sanitation && service !== 'locker' ? [{ k: 'sanitize', l: 'Sanitize' }] : []), { k: 'retrieve', l: 'Retrieve' }];
  const at: Partial<Record<Stage, string>> = { locker: 'locker', service: 'service', phone: 'phone', payment: 'payment', receipt: 'receipt', card: 'card', placement: 'store', sanitation: 'sanitize', stored: 'store', retrieval: 'retrieve', completed: 'retrieve' };
  const i = list.findIndex((x) => x.k === at[stage]);
  if (i < 0) return null;
  return <ol className="steps" aria-label="Progress">{list.map((x, k) => <li key={x.k} className={k < i ? 'done' : k === i ? 'on' : ''}><i>{k + 1}</i>{x.l}</li>)}</ol>;
}

const HINT: Record<RetrievalMethod, string> = { nfc: 'Tap your access card', otp: 'Get a code by simulated SMS', qr: 'Scan your receipt QR', code: 'Type the code on your receipt' };

export default function UI() {
  const s = useStore();
  const d = useDerived();
  const cfg = useConfig((c) => c.active);
  const view = viewId(s);
  const side = view.startsWith('locker') || view.startsWith('close');
  const compact = !side && (!['screen', 'showcase'].includes(view) || ['stored', 'completed'].includes(s.stage));
  const [muted, setMuted] = useState(sfx.isMuted());
  const [vol, setVol] = useState(sfx.getVolume());
  const [admin, setAdmin] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase(), st = useStore.getState();
      if (k === 'r') st.reset('idle'); else if (k === 'h') st.toggleHotspots(); else if (k === 'm') setMuted(sfx.toggleMute()); else if (k === 's') st.skipSanitation();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => { if (s.stage !== 'retrieval') setShowReceipts(false); }, [s.stage]);

  const inFlow = !['idle', 'completed', 'stored'].includes(s.stage);
  const price = priceOf(s.service), coins = coinsOf(s.service), next = coins[s.coins];
  const rentals = Object.entries(s.rentals).map(([k, r]) => [Number(k), r] as [number, Rental]);
  const rented = rentals.length;
  const stages = s.sanStages, san = sanitationAt(s.sanitize, stages);
  const sanTitle = s.sanitize <= 0 ? 'Preparing the compartment' : s.sanitize >= 1 ? 'Cycle completed' : `${stages[san.index]?.label ?? ''} (${san.index + 1} of ${stages.length})`;
  const av = d.methods.filter((m) => rentals.some(([, r]) => (m === 'nfc' ? !!r.cardId : m === 'otp' ? !!r.phone : m === 'qr' ? !!r.qrToken : !!r.accessCode)));
  const retrievalReceipt = cfg.hardware.receiptPrinter && cfg.receipt.type === 'retrieval';
  const qrText: Record<string, string> = { show: 'Click the QR code to scan it with your phone.', phone: 'Phone approaching…', scanning: 'Scanning code…', processing: 'Opening payment app…', receipt: 'Payment confirmed on phone.', done: '✓ Payment Successful' };
  const curReceipt: ReceiptData = {
    txnId: s.txnId ?? '', locker: s.locker ?? 0, service: CONFIG.services[s.service ?? 'locker'].label, method: s.method === 'coin' ? 'Coins' : 'Online QR', amount: price, at: s.paidAt,
    type: retrievalReceipt ? 'retrieval' : 'transaction', qrToken: s.qrToken, accessCode: s.accessCode,
  };

  let body: ReactNode = null;
  switch (s.stage) {
    case 'welcome':
      body = (<><h1>Welcome to {CONFIG.brand}</h1>
        <p>{rented === 0 ? `Secure helmet storage${d.stages.length ? ' with optional sanitation' : ''}. Lockers from ${peso(priceOf('locker'))}. You will get ${d.methods.length ? d.methods.map((m) => METHOD_LABEL[m]).join(' / ') : 'a credential'} to retrieve your helmet.` : `${rented} of ${d.total} lockers in use. Rent another locker or retrieve a stored helmet.`}</p>
        {rented === 0 ? <Btn onClick={s.begin}>Begin</Btn>
          : <div className="row"><Btn onClick={s.begin} disabled={rented >= d.total}>{rented >= d.total ? 'All lockers in use' : 'Rent a locker'}</Btn><Btn ghost onClick={s.startRetrieval}>Retrieve Helmet</Btn></div>}</>);
      break;
    case 'locker':
      body = (<><h2>Choose a locker</h2><p>The selected compartment lights up on the cabinet. Red lockers are in use.</p>
        {Array.from({ length: d.sections }, (_, k) => (
          <div key={k} className="sec"><span className="sectag">Section {k + 1} · {d.lockers[k * 3].sanitation ? 'Sanitation' : 'Basic'}</span>
            <div className="grid3">{[0, 1, 2].map((r) => {
              const i = k * 3 + r, busy = s.rentals[i] !== undefined;
              return (<button key={i} className={`tile ${busy ? 'busy' : ''}`} disabled={busy} onMouseEnter={() => s.setHover(i)} onMouseLeave={() => s.setHover(null)} onFocus={() => s.setHover(i)} onBlur={() => s.setHover(null)} onClick={() => s.selectLocker(i)}>
                <b>Locker {i + 1}</b><span><i className={`dot ${busy ? 'red' : ''}`} />{busy ? 'In use' : 'Available'}</span></button>);
            })}</div></div>))}
        <Btn ghost onClick={s.back}>Back</Btn></>);
      break;
    case 'service': {
      const canSan = s.locker !== null && d.lockers[s.locker]?.sanitation;
      body = (<><h2>Choose a service</h2>
        <div className="grid2">{(['locker', 'sanitize'] as const).map((k) => {
          const off = k === 'sanitize' && !canSan;
          return (<button key={k} className="tile wide" disabled={off} onClick={() => s.selectService(k)}><b>{CONFIG.services[k].label}</b>
            <span>{off ? 'Not available for this locker (basic section).' : k === 'sanitize' ? `${CONFIG.services[k].desc} ${d.stages.map((x) => x.label).join(' → ')}.` : CONFIG.services[k].desc}</span><em>{peso(CONFIG.services[k].price)}</em></button>);
        })}</div>
        <Btn ghost onClick={s.back}>Back</Btn></>);
      break;
    }
    case 'phone':
      body = s.phoneStep === 'enter'
        ? (<><h2>Phone verification</h2><p>Enter a test phone number. A simulated SMS with a one-time code will appear on the demo phone. Nothing is sent for real.</p>
          <CodeForm label="Test phone number" placeholder="0917 000 0000" cta="Send code" maxLength={14} onSubmit={s.submitPhone} />
          {s.otpMsg && <p className="err">{s.otpMsg}</p>}<Btn ghost onClick={s.back}>Back</Btn></>)
        : (<><h2>Enter the code</h2><p>Code sent to ••••{s.phone?.slice(-4)}. Valid for {cfg.otp.ttlSeconds}s, {cfg.otp.maxAttempts} attempts.</p>
          <CodeForm key={s.otp?.code} label="One-time code" placeholder="6 digits" cta="Verify" maxLength={6} onSubmit={s.submitOtp} />
          {s.otpMsg && <p className="err">{s.otpMsg}</p>}<Btn ghost onClick={s.resendOtp}>Resend code</Btn><Btn ghost onClick={s.back}>Back</Btn></>);
      break;
    case 'payment':
      if (!s.method) body = (<><h2>Pay {peso(price)}</h2><p>Both methods are simulated. No real payment is made.</p>
        <div className="grid2">{d.payMethods.includes('coin') && <button className="tile" onClick={() => s.chooseMethod('coin')}><b>Coin Payment</b><span>Insert four coins into the slot</span></button>}
          {d.payMethods.includes('qr') && <button className="tile" onClick={() => s.chooseMethod('qr')}><b>Online Payment via QR Code</b><span>GCash, Maya and online banking</span></button>}</div>
        <Btn ghost onClick={s.back}>Back</Btn></>);
      else if (s.method === 'coin') body = (<><h2>Insert coins</h2>
        <div className="balance"><strong>{peso(balanceAfter(s.coins, s.service))}</strong> / {peso(price)}</div>
        <div className="dots">{coins.map((v, i) => <i key={i} className={i < s.coins ? 'on' : ''}>{i < s.coins ? peso(v) : ''}</i>)}</div>
        {s.paid ? <p className="ok">✓ Payment received</p> : <Btn onClick={s.insertCoin} disabled={s.coinBusy || next === undefined}>Insert {next !== undefined ? peso(next) : ''} coin</Btn>}
        {!s.paid && s.coins === 0 && <Btn ghost onClick={s.back}>{d.payMethods.length > 1 ? 'Change method' : 'Back'}</Btn>}</>);
      else body = (<><h2>Scan to pay {peso(price)}</h2>
        <div className="qrlayout">
          <div className="qrbox">
            <button className="qrbtn" onClick={s.scanQr} disabled={s.qr !== 'show'} aria-label="Click the QR code to scan with a phone"><QrImg text={`HELMLOCK-DEMO-PAY:${price}`} />{s.qr === 'show' && <span className="qrtag">Click to scan</span>}</button>
            {(s.qr === 'phone' || s.qr === 'scanning') && <div className={`phone ${s.qr}`}><div className="scan" /></div>}
          </div>
          <div className="wallets"><h3>Supported payment apps</h3>
            <div className="wgrid">{CONFIG.wallets.map((w) => (
              <button key={w.id} style={w.id === 'other' ? { gridColumn: '1 / -1' } : undefined} className={`wbtn ${s.wallet === w.id ? 'sel' : ''}`} disabled={s.qr !== 'show'} aria-pressed={s.wallet === w.id} onClick={() => s.setWallet(w.id)}><Logo w={w} /></button>))}</div>
            <small>E-wallets and online banking. Tap one to choose the app used in this demo.</small></div>
        </div>
        <p className={s.qr === 'done' ? 'ok' : ''}>{qrText[s.qr]}</p>
        <small>Simulated demo QR. No payment gateway is connected.</small>
        {s.qr === 'show' && <Btn ghost onClick={s.back}>{d.payMethods.length > 1 ? 'Change method' : 'Back'}</Btn>}</>);
      break;
    case 'receipt':
      body = (<><h2>{s.receipt === 'collected' ? 'Receipt collected' : 'Your receipt'}</h2>
        <p>{s.receipt === 'hidden' || s.receipt === 'printing' ? 'Printing your receipt…' : s.receipt === 'ready' || s.receipt === 'collecting' ? 'Click the paper to tear it off.'
          : retrievalReceipt ? `Keep this receipt. It holds your retrieval ${[cfg.receipt.qr && 'QR code', cfg.receipt.code && 'access code'].filter(Boolean).join(' and ')}.` : 'This receipt is for your records only. It cannot unlock your locker.'}</p>
        {s.receipt === 'ready' && <Btn onClick={s.collectReceipt}>Collect receipt</Btn>}
        {s.receipt === 'collected' && <Btn onClick={s.continueFromReceipt}>Continue</Btn>}</>);
      break;
    case 'card':
      body = s.card === 'collected'
        ? (<><h2>Card collected</h2><p>Keep card <b>{s.cardId}</b>. Use it at this kiosk to retrieve your helmet from Locker {(s.locker ?? 0) + 1}.</p><Btn onClick={s.continueToPlacement}>Go to my locker</Btn></>)
        : (<><h2>{s.card === 'out' ? 'Take your access card' : 'Payment successful'}</h2><p>{s.card === 'out' ? 'Click the card sticking out of the dispenser.' : 'Issuing your access card…'}</p>{s.card === 'out' && <Btn onClick={s.collectCard}>Collect card</Btn>}</>);
      break;
    case 'placement':
      body = (<><h2>Store your helmet</h2><p>{s.helmet === 'offered' ? 'Click the helmet or press the button to place it in the locker.' : s.helmet === 'placing' ? 'Placing helmet…' : s.helmet === 'inside' ? 'Helmet stored. Closing the door…' : 'Opening the locker door…'}</p>
        {s.helmet === 'offered' && <Btn onClick={s.placeHelmet}>Place Helmet</Btn>}</>);
      break;
    case 'sanitation':
      body = (<><h2>{sanTitle}</h2>
        <ol className="stages" style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}>{stages.map((st, i) => {
          const state = s.sanitize >= 1 || i < san.index ? 'done' : i === san.index && s.sanitize > 0 ? 'on' : '';
          return <li key={st.key} className={state}><i style={{ width: state === 'done' ? '100%' : state === 'on' ? `${san.within * 100}%` : '0%' }} />{st.label}</li>;
        })}</ol>
        <p>{s.sanitize > 0 && s.sanitize < 1 ? stages[san.index]?.detail : ''} {Math.max(0, Math.ceil((1 - s.sanitize) * totalSeconds(stages)))}s remaining · <b>Simulated sanitation cycle</b></p>
        <p className="lock">🔒 Solenoid lock engaged during the cycle.</p>
        <small>Visual demonstration only. It does not show real disinfection performance or material safety.</small>
        <Btn ghost onClick={s.skipSanitation}>Skip cycle (S)</Btn></>);
      break;
    case 'stored':
      body = (<><h2>Helmet stored in Locker {(s.locker ?? 0) + 1}</h2><p>{s.service === 'sanitize' ? 'The simulated sanitation cycle is complete. ' : ''}Retrieve with: {d.methods.map((m) => METHOD_LABEL[m]).join(', ')}. Returning to the home screen…</p></>);
      break;
    case 'retrieval':
      if (s.ret === 'choose') body = (<><h2>Retrieve Helmet</h2><p>Choose how to unlock your locker.</p>
        <div className="grid2">{av.map((m) => <button key={m} className="tile" onClick={() => s.chooseRetMethod(m)}><b>{METHOD_LABEL[m]}</b><span>{HINT[m]}</span></button>)}</div><Btn ghost onClick={s.back}>Back</Btn></>);
      else if (s.ret === 'invalid') body = (<><h2>Not recognized</h2><p className="err">{s.retMsg}</p>{s.retMethod ? <Btn onClick={s.retry}>Try again</Btn> : <Btn ghost onClick={s.back}>Back</Btn>}</>);
      else if (s.ret === 'validating') body = (<><h2>Validating…</h2><div className="bar"><i className="indet" /></div></>);
      else if (s.ret === 'otp') body = (<><h2>Enter your one-time code</h2><p>Sent to the phone for Locker {(s.retLocker ?? 0) + 1}. Valid for {cfg.otp.ttlSeconds}s, {cfg.otp.maxAttempts} attempts.</p>
        <CodeForm key={s.otp?.code} label="One-time code" placeholder="6 digits" cta="Unlock" maxLength={6} onSubmit={s.submitRetrievalOtp} />
        {s.retMsg && <p className="err">{s.retMsg}</p>}<Btn ghost onClick={s.resendOtp}>Resend code</Btn><Btn ghost onClick={s.back}>Back</Btn></>);
      else if (s.ret === 'prompt' && s.retMethod === 'nfc') body = (<><h2>Present your access card</h2><p>Choose a card to tap on the reader (simulated).</p>
        <div className="grid2">{rentals.filter(([, r]) => r.cardId).map(([i, r]) => <button key={i} className="tile" onClick={() => s.presentCard(r.cardId!)}><b>Locker {i + 1} card</b><span>{r.cardId}</span></button>)}
          <button className="tile" onClick={() => s.presentCard('HL-0000')}><b>Another card</b><span>HL-0000 (not issued)</span></button></div><Btn ghost onClick={s.back}>Back</Btn></>);
      else if (s.ret === 'prompt' && s.retMethod === 'qr') body = (<><h2>Scan your receipt QR</h2><p>No camera is used. Pick a receipt to simulate the scanner reading it.</p>
        <div className="grid2">{rentals.filter(([, r]) => r.qrToken).map(([i, r]) => <button key={i} className="tile" onClick={() => s.scanReceipt(qrPayload(r.qrToken!))}><b>Receipt · Locker {i + 1}</b><span>Simulate scan</span></button>)}
          <button className="tile" onClick={() => s.scanReceipt('hl2:UNKNOWN')}><b>Unknown QR</b><span>Not from this kiosk</span></button></div>
        <Btn ghost onClick={() => setShowReceipts(!showReceipts)}>{showReceipts ? 'Hide' : 'View'} my receipts</Btn><Btn ghost onClick={s.back}>Back</Btn></>);
      else if (s.ret === 'prompt' && s.retMethod === 'code') body = (<><h2>Enter your access code</h2><p>Type the code printed on your receipt.</p>
        <CodeForm label="Access code" placeholder="6 digits" cta="Unlock" maxLength={6} onSubmit={s.submitCode} />
        <Btn ghost onClick={() => setShowReceipts(!showReceipts)}>{showReceipts ? 'Hide' : 'View'} my receipts (demo)</Btn><Btn ghost onClick={s.back}>Back</Btn></>);
      else if (s.ret === 'prompt' && s.retMethod === 'otp') body = (<><h2>Which locker?</h2><p>A one-time code will be sent to the phone used for the rental (simulated).</p>
        <div className="grid2">{rentals.filter(([, r]) => r.phone).map(([i, r]) => <button key={i} className="tile" onClick={() => s.requestRetrievalOtp(i)}><b>Locker {i + 1}</b><span>••••{r.phone!.slice(-4)}</span></button>)}</div><Btn ghost onClick={s.back}>Back</Btn></>);
      else body = (<><h2>{s.ret === 'ready' ? 'Take your helmet' : s.ret === 'taking' ? 'Removing helmet…' : '✓ Access granted'}</h2><p>{s.ret === 'ready' ? 'Click the helmet to remove it.' : `Opening Locker ${(s.locker ?? 0) + 1}…`}</p></>);
      break;
    case 'completed':
      body = (<><h1>Thanks for riding with {CONFIG.brand}</h1><p>Demo complete: storage{s.service === 'sanitize' ? ', sanitation' : ''} and retrieval were all simulated.{rented > 0 ? ` ${rented} other locker${rented > 1 ? 's are' : ' is'} still in use.` : ''}</p>
        <div className="row"><Btn onClick={() => s.reset('idle')}>Restart</Btn><Btn ghost onClick={() => s.home('welcome')}>Welcome screen</Btn><Btn ghost onClick={() => s.reset('idle', true)}>Replay guided intro</Btn></div></>);
      break;
  }

  return (
    <div className="ui">
      <header><div className="brand"><b>HelmLock V2</b><span>Smart helmet storage and sanitation kiosk</span></div>
        <div className="top"><span className="badge">Simulation: no hardware, no real payments</span>
          {!inFlow && <Btn ghost onClick={() => setAdmin(true)}>⚙ Admin</Btn>}
          <button className="btn ghost sm" data-silent onClick={s.toggleHotspots} aria-pressed={s.hotspots}>📍 Hotspots</button>
          <button className="btn ghost sm" data-silent onClick={() => s.setSpeed(s.speed === 1 ? 1.5 : s.speed === 1.5 ? 2 : 1)}>⏩ {s.speed}×</button>
          <input className="vol" type="range" min={0} max={1} step={0.05} value={vol} aria-label="Volume" onChange={(e) => { const v = Number(e.target.value); setVol(v); sfx.setVolume(v); }} />
          <button className="btn ghost sm" data-silent aria-pressed={!muted} onClick={() => setMuted(sfx.toggleMute())}>{muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
          {inFlow && <Btn ghost onClick={() => s.home()}>Exit demo</Btn>}</div></header>
      <Steps stage={s.stage} service={s.service} />
      {s.stage === 'idle' && <div className="hint">{rented > 0 ? 'Click the touchscreen to rent another locker or retrieve a helmet' : 'Drag to rotate · Click the touchscreen to begin · Try a locker door · H: hotspots'}</div>}
      <div className={`warn ${s.warning ? 'show' : ''}`} role="alert">Unauthorized Access Prohibited.</div>
      {body && (
        <section key={s.stage + s.method + s.ret + s.retMethod + s.card + s.phoneStep + s.receipt} className={`panel ${compact ? 'compact' : ''} ${side ? 'side' : ''} ${s.stage === 'payment' && s.method === 'qr' ? 'wide' : ''}`}>
          {['service', 'phone', 'payment', 'receipt', 'card', 'placement', 'sanitation', 'stored'].includes(s.stage) && s.locker !== null && (
            <div className="chips"><span>Locker {s.locker + 1}</span>{s.service && <span>{CONFIG.services[s.service].label}</span>}
              {s.paid && <span>Paid {peso(price)}</span>}{s.cardId && <span>Card {s.cardId}</span>}</div>)}
          {body}
        </section>)}
      {s.stage === 'receipt' && s.receipt === 'collected' && <div className="paperwrap"><Receipt r={curReceipt} /></div>}
      {showReceipts && s.stage === 'retrieval' && <div className="paperwrap">{rentals.map(([i, r]) => <Receipt key={i} r={receiptOf(i, r)} />)}</div>}
      <PayPhone /><SmsPhone />
      {admin && <Admin onClose={() => setAdmin(false)} />}
    </div>
  );
}
