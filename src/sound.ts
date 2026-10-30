/** Procedural sound effects (Web Audio API). No audio files needed. Raise MASTER for louder output. */
const MASTER = 1.3;
let ctx: AudioContext | null = null;
let master: GainNode;
let noiseBuf: AudioBuffer;
let muted = false;
let vol = 1;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = MASTER * vol;
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
function unlock() { const c = ensure(); if (c && c.state !== 'running') void c.resume(); }
const live = () => !!ctx && ctx.state === 'running' && !muted;

interface TO { type?: OscillatorType; gain?: number; to?: number; attack?: number; at?: number }
function tone(freq: number, dur: number, o: TO = {}) {
  const c = ctx!, t0 = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type ?? 'sine'; osc.frequency.setValueAtTime(freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.5, t0 + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + dur + 0.05);
}
interface NO { type?: BiquadFilterType; freq: number; to?: number; q?: number; gain?: number; attack?: number; at?: number }
function noise(dur: number, o: NO) {
  const c = ctx!, t0 = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = c.createBiquadFilter(); f.type = o.type ?? 'bandpass'; f.Q.value = o.q ?? 1; f.frequency.setValueAtTime(o.freq, t0);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.4, t0 + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}

/* ---- looping ambience for the sanitation stages: uv, fog, ozone, dry ---- */
let amb: { stop: () => void } | null = null;
function ambient(kind: string | null) {
  if (amb) { amb.stop(); amb = null; }
  if (!kind || !live()) return;
  const c = ctx!;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, c.currentTime); out.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.4); out.connect(master);
  const srcs: AudioScheduledSourceNode[] = [], timers: number[] = [];
  const nz = (type: BiquadFilterType, freq: number, q: number, gain: number) => {
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(out); s.start(); srcs.push(s); return { f, g };
  };
  const osc = (type: OscillatorType, freq: number, gain: number) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gain; o.connect(g); g.connect(out); o.start(); srcs.push(o); return { o, g };
  };
  const lfo = (rate: number, depth: number, param: AudioParam) => {
    const l = c.createOscillator(); l.frequency.value = rate;
    const lg = c.createGain(); lg.gain.value = depth; l.connect(lg); lg.connect(param); l.start(); srcs.push(l);
  };
  if (kind === 'uv') { // electric hum + crackle
    const a = osc('sawtooth', 100, 0.22); osc('square', 200.7, 0.1);
    const z = nz('bandpass', 3200, 4, 0.18); lfo(9, 0.12, a.g.gain); lfo(5, 0.1, z.g.gain);
    timers.push(window.setInterval(() => { if (live()) tone(2400 + Math.random() * 1500, 0.08, { type: 'square', gain: 0.2, to: 600 }); }, 420));
  } else if (kind === 'fog' || kind === 'mist') { // hissing mist (misting is softer)
    const n = nz('highpass', 2500, 0.7, kind === 'mist' ? 0.28 : 0.5); nz('bandpass', 6000, 0.6, 0.35); lfo(0.5, 0.18, n.g.gain);
  } else if (kind === 'ozone') { // airy swirl + bubbles
    const n = nz('bandpass', 700, 5, 0.5); lfo(0.4, 500, n.f.frequency);
    const v = osc('sine', 196, 0.18); lfo(5, 6, v.o.frequency);
    timers.push(window.setInterval(() => { if (live()) tone(500 + Math.random() * 1200, 0.12, { gain: 0.3, to: 900 + Math.random() * 900 }); }, 180));
  } else if (kind === 'dry' || kind === 'heat' || kind === 'air') { // fan (+ heater hum)
    const n = nz('lowpass', 900, 0.8, 0.7); lfo(16, 0.35, n.g.gain); osc('sine', 85, 0.25); nz('bandpass', 1800, 1, 0.18);
    timers.push(window.setInterval(() => { if (live()) noise(0.05, { type: 'highpass', freq: 4000, gain: 0.15 }); }, 900));
  } else if (kind === 'mist') { // fine mist
    nz('highpass', 4200, 0.7, 0.4); const n = nz('bandpass', 7000, 0.6, 0.25); lfo(0.8, 0.1, n.g.gain);
  } else if (kind === 'air') { // cool fan airflow
    const n = nz('lowpass', 1400, 0.7, 0.55); lfo(11, 0.25, n.g.gain); nz('highpass', 3000, 0.7, 0.18);
  }
  amb = {
    stop: () => {
      timers.forEach((t) => window.clearInterval(t));
      out.gain.cancelScheduledValues(c.currentTime); out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), c.currentTime);
      out.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.3);
      srcs.forEach((s) => { try { s.stop(c.currentTime + 0.35); } catch { /* already stopped */ } });
    },
  };
}

const g = (fn: () => void) => () => { if (live()) fn(); };

export const sfx = {
  isMuted: () => muted,
  getVolume: () => vol,
  setVolume: (v: number) => { vol = v; if (master) master.gain.value = MASTER * v; },
  toggleMute: () => { muted = !muted; if (muted) ambient(null); else unlock(); return muted; },
  ambient,
  click: g(() => { tone(1200, 0.07, { type: 'square', gain: 0.3, to: 700 }); tone(2400, 0.03, { gain: 0.2 }); }),
  tick: g(() => tone(1600, 0.035, { gain: 0.18 })),
  select: g(() => { tone(660, 0.12, { gain: 0.5 }); tone(990, 0.18, { gain: 0.5, at: 0.08 }); }),
  wake: g(() => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.5, at: i * 0.08 })); tone(1568, 0.5, { gain: 0.3, at: 0.34 }); }),
  denied: g(() => {
    [0, 0.3].forEach((a) => { tone(150, 0.22, { type: 'sawtooth', gain: 0.65, at: a }); tone(155, 0.22, { type: 'square', gain: 0.3, at: a }); });
    [0, 0.06, 0.3, 0.36].forEach((a) => { tone(95, 0.12, { gain: 0.9, to: 40, at: a }); noise(0.08, { type: 'lowpass', freq: 500, gain: 0.6, at: a }); });
  }),
  whoosh: g(() => noise(0.8, { type: 'bandpass', freq: 300, to: 3200, q: 1.2, gain: 0.45, attack: 0.25 })),
  doorOpen: g(() => {
    tone(1900, 0.03, { type: 'square', gain: 0.5 }); noise(0.05, { type: 'highpass', freq: 3000, gain: 0.5 });
    tone(160, 0.55, { type: 'sawtooth', gain: 0.22, to: 320, at: 0.06 });
    noise(0.8, { type: 'bandpass', freq: 350, to: 900, q: 9, gain: 0.35, at: 0.1, attack: 0.1 });
    tone(1300, 0.05, { type: 'square', gain: 0.35, at: 0.75 });
  }),
  doorClose: g(() => {
    noise(0.7, { type: 'bandpass', freq: 900, to: 350, q: 9, gain: 0.35, attack: 0.1 });
    tone(90, 0.3, { gain: 1, to: 35, at: 0.7 }); noise(0.18, { type: 'lowpass', freq: 400, gain: 0.8, at: 0.7 });
    tone(1900, 0.03, { type: 'square', gain: 0.5, at: 0.85 });
  }),
  coinToss: g(() => noise(0.25, { type: 'bandpass', freq: 1200, to: 2500, q: 2, gain: 0.18 })),
  coin: g(() => {
    tone(2637, 0.55, { gain: 0.55 }); tone(3520, 0.45, { gain: 0.4, at: 0.02 }); tone(1760, 0.3, { type: 'triangle', gain: 0.35 });
    noise(0.04, { type: 'highpass', freq: 5000, gain: 0.5 }); tone(120, 0.12, { gain: 0.6, to: 60, at: 0.05 }); tone(1300, 0.09, { type: 'square', gain: 0.25, at: 0.16 });
  }),
  paid: g(() => { [784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.28, { type: 'triangle', gain: 0.6, at: i * 0.1 })); tone(2093, 0.9, { gain: 0.5, at: 0.42 }); tone(1047, 0.9, { type: 'square', gain: 0.15, at: 0.42 }); }),
  scan: g(() => {
    tone(500, 0.7, { type: 'triangle', gain: 0.35, to: 2600 }); tone(500, 0.7, { type: 'triangle', gain: 0.35, to: 2600, at: 0.75 });
    tone(2000, 0.12, { type: 'square', gain: 0.4, at: 1.4 }); tone(2000, 0.12, { type: 'square', gain: 0.4, at: 1.56 });
  }),
  processing: g(() => { for (let i = 0; i < 6; i++) tone(500 + i * 80, 0.1, { gain: 0.3, at: i * 0.12 }); }),
  success: g(() => { [659, 831, 988, 1319].forEach((f, i) => tone(f, 0.9, { gain: 0.5, at: i * 0.09 })); tone(1976, 0.8, { gain: 0.3, at: 0.4 }); }),
  error: g(() => { [0, 0.28].forEach((a) => { tone(300, 0.25, { type: 'sawtooth', gain: 0.55, to: 150, at: a }); tone(305, 0.25, { type: 'square', gain: 0.25, to: 150, at: a }); }); }),
  dispense: g(() => {
    tone(80, 0.9, { type: 'sawtooth', gain: 0.3, to: 200 });
    for (let i = 0; i < 8; i++) noise(0.04, { type: 'highpass', freq: 2500, gain: 0.35, at: i * 0.1 });
    tone(100, 0.15, { gain: 0.8, to: 50, at: 0.92 });
  }),
  cardPick: g(() => { noise(0.3, { type: 'bandpass', freq: 1800, to: 5000, q: 1.5, gain: 0.5 }); tone(1568, 0.12, { gain: 0.5, at: 0.18 }); tone(2093, 0.2, { gain: 0.5, at: 0.3 }); }),
  cardInsert: g(() => {
    noise(0.35, { type: 'bandpass', freq: 2500, to: 900, q: 1.5, gain: 0.5 }); tone(500, 0.05, { type: 'square', gain: 0.4, at: 0.35 });
    tone(1500, 0.1, { gain: 0.45, at: 0.5 }); tone(1800, 0.12, { gain: 0.45, at: 0.62 });
  }),
  sms: g(() => { [0, 0.4].forEach((a) => { tone(1318, 0.12, { gain: 0.5, at: a }); tone(1760, 0.2, { gain: 0.5, at: a + 0.14 }); }); }),
  print: g(() => { for (let i = 0; i < 14; i++) noise(0.05, { type: 'bandpass', freq: 2200, q: 3, gain: 0.35, at: i * 0.12 }); tone(150, 1.7, { type: 'sawtooth', gain: 0.15, to: 170 }); }),
  thump: g(() => { tone(110, 0.35, { gain: 1, to: 42 }); noise(0.18, { type: 'lowpass', freq: 350, gain: 0.8 }); }),
  pop: g(() => { tone(380, 0.14, { gain: 0.6, to: 1000 }); tone(1500, 0.08, { gain: 0.3, at: 0.1 }); }),
  stageChange: g(() => {
    tone(350, 0.4, { type: 'sawtooth', gain: 0.3, to: 1500 }); tone(1568, 0.5, { gain: 0.5, at: 0.32 }); tone(2093, 0.5, { gain: 0.35, at: 0.4 });
    noise(0.5, { type: 'bandpass', freq: 400, to: 4000, q: 1, gain: 0.3 });
  }),
  complete: g(() => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.6, at: i * 0.13 })); [523, 659, 784].forEach((f) => tone(f, 1.4, { gain: 0.35, at: 0.6 })); }),
  stored: g(() => { tone(880, 0.4, { gain: 0.5 }); tone(1175, 0.6, { gain: 0.5, at: 0.15 }); tone(110, 0.3, { gain: 0.7, to: 50 }); }),
  printer: g(() => { for (let i = 0; i < 16; i++) { noise(0.05, { type: 'bandpass', freq: 2200, q: 3, gain: 0.35, at: i * 0.11 }); tone(180, 0.06, { type: 'square', gain: 0.2, at: i * 0.11 }); } tone(1800, 0.1, { type: 'square', gain: 0.4, at: 1.85 }); }),
  fanfare: g(() => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: 'square', gain: 0.3, at: i * 0.14 })); [523, 659, 784, 1047].forEach((f) => tone(f, 1.6, { type: 'triangle', gain: 0.4, at: 0.6 })); }),
};

if (typeof window !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (b && !b.hasAttribute('data-silent')) sfx.click();
  }, true);
}
