import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useConfig, validateConfig, derive, checkApply, defaults, mkStage, STAGE_INFO, CLEAN_KEYS, DRY_KEYS, MAX_SECTIONS, METHOD_LABEL, totalSeconds, StageKey, SectionType } from './system';
import { useStore } from './store';
import { sfx } from './sound';

function Check({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`chk ${disabled ? 'dis' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}
const Num = ({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) => (
  <label className="num">{label}<input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} /></label>
);
const Block = ({ title, children }: { title: string; children: ReactNode }) => <section className="ablock"><h3>{title}</h3>{children}</section>;

/** System Configuration: edits a draft, previews it, then applies it to the live cabinet and kiosk without a reload. */
export default function Admin({ onClose }: { onClose: () => void }) {
  const draft = useConfig((s) => s.draft);
  const active = useConfig((s) => s.active);
  const edit = useConfig((s) => s.setDraft);
  const rentals = useStore((s) => s.rentals);
  const stage = useStore((s) => s.stage);
  const [msg, setMsg] = useState('');
  const { errors, warnings } = useMemo(() => validateConfig(draft), [draft]);
  const blockers = useMemo(() => checkApply(draft, rentals, stage), [draft, rentals, stage]);
  const d = useMemo(() => derive(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(active);
  const n = draft.sections.length;
  const lastBusy = [0, 1, 2].some((r) => rentals[(n - 1) * 3 + r]);
  const hw = draft.hardware;
  const close = () => { useConfig.getState().resetDraft(); onClose(); };
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  const setStage = (key: StageKey, on: boolean) => edit((c) => { c.stages = on ? [...c.stages, mkStage(key)] : c.stages.filter((s) => s.key !== key); });
  const move = (key: StageKey, dir: -1 | 1) => edit((c) => {
    const i = c.stages.findIndex((s) => s.key === key), j = i + dir;
    if (j < 1 || j >= c.stages.length || STAGE_INFO[c.stages[j].key].group !== 'clean') return;
    [c.stages[i], c.stages[j]] = [c.stages[j], c.stages[i]];
  });
  const field = (key: StageKey, f: 'label' | 'detail' | 'seconds', v: string | number) => edit((c) => { const s = c.stages.find((x) => x.key === key); if (s) (s as unknown as Record<string, string | number>)[f] = v; });
  const addable = CLEAN_KEYS.filter((k) => !draft.stages.some((s) => s.key === k));

  const apply = () => { useConfig.getState().apply(); sfx.success(); setMsg('Applied. The cabinet, kiosk and flow now follow this configuration.'); };
  const restore = () => {
    const issues = checkApply(defaults(), rentals, stage);
    if (issues.length) { setMsg(`Cannot restore defaults yet: ${issues.join(' ')}`); return; }
    useConfig.getState().restoreDefaults(); setMsg('Defaults restored (1 × 3 lockers, NFC, original sanitation).');
  };

  return (
    <aside className="admin" role="dialog" aria-label="System configuration">
      <header><div><h2>System Configuration</h2><small>Simulation of modular hardware. Nothing here controls real devices.</small></div><button className="btn ghost sm" onClick={close}>✕ Close</button></header>
      <div className="abody">
        <Block title="A · Hardware modules">
          <Check label="Receipt printer" hint="Shows the printer and animated paper. Choose the receipt type in section B." checked={hw.receiptPrinter} onChange={(v) => edit((c) => { c.hardware.receiptPrinter = v; })} />
          <Check label="NFC card dispenser and reader" hint="Adds card issuance and card tap retrieval." checked={hw.nfc} onChange={(v) => edit((c) => { c.hardware.nfc = v; })} />
          <Check label="Phone number and OTP verification" hint="Adds phone entry, simulated SMS and OTP retrieval." checked={hw.otp} onChange={(v) => edit((c) => { c.hardware.otp = v; })} />
          <Check label="Sanitation module" hint="UV-C is fixed as the first stage while this is on." checked={hw.sanitation} onChange={(v) => edit((c) => { c.hardware.sanitation = v; })} />
          <Check label="Air-drying module" hint="Drying is always the last stage." checked={draft.stages.some((s) => s.key === 'airdry')} disabled={!hw.sanitation} onChange={(v) => setStage('airdry', v)} />
          <Check label="Heat-drying module" hint="Requires the sanitation module." checked={draft.stages.some((s) => s.key === 'heatdry')} disabled={!hw.sanitation} onChange={(v) => setStage('heatdry', v)} />
          <Check label="Coin payment" checked={draft.payment.coin} onChange={(v) => edit((c) => { c.payment.coin = v; })} />
          <Check label="Online QR payment" checked={draft.payment.qr} onChange={(v) => edit((c) => { c.payment.qr = v; })} />
        </Block>

        <Block title="B · Retrieval and receipts">
          <p className="note">Active retrieval methods: {d.methods.length ? d.methods.map((m) => METHOD_LABEL[m]).join(', ') : 'none'}. NFC and OTP follow the hardware toggles above.</p>
          <label className="num">Receipt type
            <select value={draft.receipt.type} disabled={!hw.receiptPrinter} onChange={(e) => edit((c) => { c.receipt.type = e.target.value as 'transaction' | 'retrieval'; })}>
              <option value="retrieval">Retrieval receipt (credential)</option><option value="transaction">Transaction receipt (record only)</option>
            </select></label>
          <Check label="QR code on receipt" checked={draft.receipt.qr} disabled={!hw.receiptPrinter || draft.receipt.type !== 'retrieval'} onChange={(v) => edit((c) => { c.receipt.qr = v; })} />
          <Check label="Printed access code" checked={draft.receipt.code} disabled={!hw.receiptPrinter || draft.receipt.type !== 'retrieval'} onChange={(v) => edit((c) => { c.receipt.code = v; })} />
          <div className="numrow">
            <Num label="OTP lifetime (s)" value={draft.otp.ttlSeconds} min={30} max={600} onChange={(v) => edit((c) => { c.otp.ttlSeconds = v; })} />
            <Num label="OTP attempts" value={draft.otp.maxAttempts} min={1} max={10} onChange={(v) => edit((c) => { c.otp.maxAttempts = v; })} />
            <Num label="Access code valid (min)" value={draft.codeTtlMinutes} min={1} max={10080} onChange={(v) => edit((c) => { c.codeTtlMinutes = v; })} />
          </div>
        </Block>

        <Block title="C · Sanitation sequence">
          {!hw.sanitation ? <p className="note">Sanitation module is off.</p> : (<>
            <p className="note">Strict order: UV-C first, then cleaning procedures, then drying last.</p>
            {draft.stages.map((s, i) => {
              const g = STAGE_INFO[s.key].group;
              return (
                <div key={s.key} className={`stg ${g}`}>
                  <div className="stghead"><b>{i + 1}</b>
                    <input aria-label="Stage label" value={s.label} onChange={(e) => field(s.key, 'label', e.target.value)} />
                    <input aria-label="Seconds" className="sec" type="number" min={1} max={60} value={s.seconds} onChange={(e) => field(s.key, 'seconds', Number(e.target.value))} /><span>s</span>
                    {g === 'uv' && <em title="Fixed: always first">🔒 first</em>}
                    {g === 'dry' && <em title="Drying is always last">last</em>}
                    {g === 'clean' && <><button className="btn ghost sm" aria-label="Move up" onClick={() => move(s.key, -1)}>↑</button><button className="btn ghost sm" aria-label="Move down" onClick={() => move(s.key, 1)}>↓</button><button className="btn ghost sm" aria-label="Remove" onClick={() => setStage(s.key, false)}>✕</button></>}
                  </div>
                  <input aria-label="Stage description" className="desc" value={s.detail} onChange={(e) => field(s.key, 'detail', e.target.value)} />
                </div>);
            })}
            {addable.length > 0 && <div className="addrow">Add cleaning procedure: {addable.map((k) => <button key={k} className="btn ghost sm" onClick={() => setStage(k, true)}>+ {STAGE_INFO[k].label}</button>)}</div>}
            <div className="preview"><b>Preview:</b> {d.stages.map((s, i) => <span key={s.key} className="chip">{i + 1}. {s.label} · {s.seconds}s</span>)} <em>Total {totalSeconds(d.stages)}s · {d.stages.length} stages</em></div>
            <p className="note">Configurable visual demonstration only. It does not validate disinfection effectiveness or material safety.</p>
          </>)}
        </Block>

        <Block title="D · Locker sections">
          {draft.sections.map((t, k) => {
            const busy = [0, 1, 2].some((r) => rentals[k * 3 + r]);
            return (
              <label key={k} className="num">Section {k + 1} (lockers {k * 3 + 1}-{k * 3 + 3}){busy ? ' · in use' : ''}
                <select value={t} disabled={busy} onChange={(e) => edit((c) => { c.sections[k] = e.target.value as SectionType; })}>
                  <option value="sanitation">Locker with Sanitation</option><option value="locker">Locker Only</option>
                </select></label>);
          })}
          <div className="addrow">
            <button className="btn ghost sm" disabled={n >= MAX_SECTIONS} onClick={() => edit((c) => { c.sections.push('sanitation'); })}>+ Add section</button>
            <button className="btn ghost sm" disabled={n <= 1 || lastBusy} title={lastBusy ? 'Active rental in this section' : ''} onClick={() => edit((c) => { c.sections.pop(); })}>− Remove last section</button>
            <em>{n} × 3 = {d.total} lockers</em>
          </div>
          <div className="cab" aria-label="Cabinet layout preview"><div className="kiosk">KIOSK</div>
            {draft.sections.map((_, k) => (
              <div className="tower" key={k}>{[2, 1, 0].map((r) => { const i = k * 3 + r, L = d.lockers[i]; return <div key={r} className={`lk ${L.sanitation ? 'san' : ''} ${rentals[i] ? 'occ' : ''}`}>{i + 1}{L.sanitation && <em>UV</em>}</div>; })}</div>))}
          </div>
        </Block>
      </div>
      <footer>
        {errors.map((e) => <p key={e} className="err">⚠ {e}</p>)}
        {blockers.map((e) => <p key={e} className="err">⛔ {e}</p>)}
        {warnings.map((e) => <p key={e} className="warnl">ℹ {e}</p>)}
        {msg && <p className="ok">{msg}</p>}
        <div className="row">
          <button className="btn" disabled={!dirty || errors.length > 0 || blockers.length > 0} onClick={apply}>Apply changes</button>
          <button className="btn ghost" disabled={!dirty} onClick={() => { useConfig.getState().resetDraft(); setMsg(''); }}>Discard</button>
          <button className="btn ghost" onClick={restore}>Restore defaults</button>
        </div>
      </footer>
    </aside>
  );
}
