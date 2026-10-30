import * as THREE from 'three';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, MeshProps } from '@react-three/fiber';
import { OrbitControls, Environment, Lightformer, ContactShadows, MeshReflectorMaterial, Html, RoundedBox } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import gsap from 'gsap';
import { useStore, viewId, Stage } from './store';
import { CONFIG, coinsOf } from './config';
import { useConfig, useDerived, sanitationAt, StageKey } from './system';
import { KX, FZ, Y, towerX, lockerPos, COIN_SLOT, viewFor } from './layout';
import { sfx } from './sound';

const T = CONFIG.timing;
const TEAL = '#2ee6d0';
const cursor = (on: boolean) => { document.body.style.cursor = on ? 'pointer' : 'auto'; };

/* ---------- procedural textures (no network assets) ---------- */
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const labelTex = (text: string, fg = '#dffcf8', size = 64) => canvasTex(512, 128, (x) => {
  x.fillStyle = fg; x.font = `700 ${size}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 64);
});
const screenTex = (a: string, b: string) => canvasTex(640, 400, (x) => {
  const g = x.createLinearGradient(0, 0, 640, 400); g.addColorStop(0, '#0d1d33'); g.addColorStop(1, '#0a3a44');
  x.fillStyle = g; x.fillRect(0, 0, 640, 400);
  x.strokeStyle = TEAL; x.lineWidth = 4; x.strokeRect(14, 14, 612, 372);
  x.textAlign = 'center'; x.fillStyle = '#e8fffb'; x.font = '700 64px system-ui'; x.fillText(a, 320, 180);
  x.fillStyle = TEAL; x.font = '500 34px system-ui'; x.fillText(b, 320, 250);
});
const cardTex = () => canvasTex(512, 320, (x) => {
  const g = x.createLinearGradient(0, 0, 512, 320); g.addColorStop(0, '#0f2a44'); g.addColorStop(1, '#13867c');
  x.fillStyle = g; x.fillRect(0, 0, 512, 320);
  x.fillStyle = '#e8fffb'; x.font = '700 50px system-ui'; x.fillText('HelmLock V2', 36, 100);
  x.fillStyle = TEAL; x.font = '500 28px system-ui'; x.fillText('ACCESS CARD · DEMO', 36, 150);
  x.fillStyle = '#f0c75e'; x.fillRect(36, 220, 80, 60);
});
const plateTex = (n: string) => canvasTex(128, 128, (x) => {
  x.fillStyle = '#0d1624'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = TEAL; x.lineWidth = 6; x.strokeRect(5, 5, 118, 118);
  x.fillStyle = '#dffcf8'; x.font = '700 78px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n, 64, 70);
});
const receiptTex = () => canvasTex(128, 320, (x) => {
  x.fillStyle = '#f7f7f2'; x.fillRect(0, 0, 128, 320);
  x.fillStyle = '#222'; x.font = '700 15px system-ui'; x.textAlign = 'center'; x.fillText('HELMLOCK V2', 64, 24);
  x.fillStyle = '#9a9a9a'; for (let i = 0; i < 9; i++) x.fillRect(14, 42 + i * 14, 60 + ((i * 37) % 40), 5);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if ((r * 7 + c * 3 + r * c) % 3) { x.fillStyle = '#222'; x.fillRect(34 + c * 10, 190 + r * 10, 9, 9); }
});
/** Round particle sprites: soft puff (mist, sparks) or ring (ozone bubbles). */
const spriteTex = (ring: boolean) => canvasTex(64, 64, (x) => {
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (ring) { g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.7, 'rgba(255,255,255,0.15)'); g.addColorStop(0.88, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
});
/** Text shown on the 3D kiosk screen for every stage (kept in sync with the touchscreen panel). */
const SCREENS: Record<Stage, [string, string]> = {
  idle: ['Touch to start', 'HelmLock V2'], welcome: ['Welcome', 'Rent or retrieve'], locker: ['Choose a locker', 'Tap a free locker'],
  service: ['Choose service', 'Locker or + Sanitation'], phone: ['Phone check', 'Enter the demo OTP'], payment: ['Payment', 'Coin or QR code'],
  receipt: ['Your receipt', 'Tear off the paper'], card: ['Take your card', 'Access card ready'], placement: ['Store your helmet', 'Door unlocked'],
  sanitation: ['Sanitizing…', 'Door locked'], stored: ['Helmet stored', 'Thank you'], retrieval: ['Retrieve helmet', 'Use your credential'], completed: ['Thank you', 'See you again'],
};
const screenCache = new Map<string, THREE.CanvasTexture>();
function getScreen(a: string, b: string) {
  const k = a + '|' + b; let t = screenCache.get(k);
  if (!t) { t = screenTex(a, b); screenCache.set(k, t); }
  return t;
}

/* ---------- small helpers ---------- */
type BP = { p: [number, number, number]; a: [number, number, number]; c?: string; m?: number; r?: number; e?: string; ei?: number; round?: number } & Omit<MeshProps, 'position' | 'args'>;
function B({ p, a, c = '#2a3039', m = 0.55, r = 0.42, e, ei = 0, round, ...rest }: BP) {
  const material = <meshStandardMaterial color={c} metalness={m} roughness={r} emissive={e ?? '#000000'} emissiveIntensity={ei} />;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (round) return <RoundedBox position={p} args={a} radius={round} smoothness={3} castShadow receiveShadow {...(rest as any)}>{material}</RoundedBox>;
  return <mesh position={p} castShadow receiveShadow {...rest}><boxGeometry args={a} />{material}</mesh>;
}
/** Hardware module wrapper: scales in when `on` becomes true and out when it becomes false (config-driven add/remove animation). */
function Appear({ on = true, position, children }: { on?: boolean; position?: [number, number, number]; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, d) => {
    const o = g.current; if (!o) return;
    const s = o.scale.x + ((on ? 1 : 0) - o.scale.x) * Math.min(1, d * 6);
    o.scale.setScalar(Math.max(s, 0.0001)); o.visible = s > 0.02;
  });
  return <group ref={g} position={position} scale={0.0001}>{children}</group>;
}
function useStageKey(i: number): StageKey | '' {
  return useStore((s) => (s.stage === 'sanitation' && s.locker === i ? (s.sanStages[sanitationAt(s.sanitize, s.sanStages).index]?.key ?? '') : '')) as StageKey | '';
}

/* ---------- locker sections (generated from configuration) ---------- */
function Fan({ stageKey, heat }: { stageKey: StageKey | ''; heat: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, d) => { const sp = stageKey === 'airdry' ? 18 : stageKey === 'heatdry' ? 14 : stageKey === 'ozone' ? 3 : 0; if (g.current) g.current.rotation.z += d * sp; });
  return (
    <group ref={g}>
      {[0, 1, 2, 3].map((k) => <mesh key={k} rotation={[0, 0, (k * Math.PI) / 2]}><boxGeometry args={[0.012, 0.09, 0.004]} /><meshStandardMaterial color="#111820" /></mesh>)}
      <mesh><cylinderGeometry args={[0.014, 0.014, 0.01, 12]} /><meshStandardMaterial color="#556" /></mesh>
      {heat && <mesh><torusGeometry args={[0.05, 0.004, 8, 24]} /><meshStandardMaterial color="#ff7a2e" emissive="#ff5a1a" emissiveIntensity={stageKey === 'heatdry' ? 2 : 0.3} /></mesh>}
    </group>
  );
}

function Interior({ i, row }: { i: number; row: number }) {
  const d = useDerived();
  const san = !!d.lockers[i]?.sanitation;
  const has = (k: StageKey) => d.stages.some((s) => s.key === k);
  const yc = Y[row];
  const key = useStageKey(i);
  const open = useStore((s) => s.doorOpen[i]);
  const light = useRef<THREE.PointLight>(null);
  const uv = useRef<THREE.MeshStandardMaterial>(null);
  const mist = useRef<THREE.MeshStandardMaterial>(null);
  const oz = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const lerp = (m: THREE.MeshStandardMaterial | null, t: number) => { if (m) m.emissiveIntensity += (t - m.emissiveIntensity) * 0.1; };
    if (light.current) light.current.intensity += ((open ? 1.4 : key ? 0.35 : 0.03) - light.current.intensity) * 0.1;
    lerp(uv.current, key === 'uv' ? 5 : 1.2); lerp(mist.current, key === 'fogging' || key === 'misting' ? 2.2 : 0.5); lerp(oz.current, key === 'ozone' ? 2.5 : 0.3);
  });
  return (
    <group>
      <Appear on={san} position={[0, yc + 0.27, 0]}>
        <mesh><boxGeometry args={[0.26, 0.008, 0.03]} /><meshStandardMaterial ref={uv} color="#6b4bd6" emissive="#8b5cff" emissiveIntensity={1.2} metalness={0} /></mesh>
      </Appear>
      <Appear on={san && (has('fogging') || has('misting'))} position={[0, yc - 0.28, -0.05]}>
        <mesh><boxGeometry args={[0.2, 0.012, 0.2]} /><meshStandardMaterial ref={mist} color="#0b4a52" emissive={TEAL} emissiveIntensity={0.5} metalness={0.2} /></mesh>
      </Appear>
      <Appear on={san && has('ozone')} position={[-0.1, yc + 0.2, -0.19]}>
        <mesh><boxGeometry args={[0.07, 0.07, 0.03]} /><meshStandardMaterial ref={oz} color="#2a3a4a" emissive="#6dffb8" emissiveIntensity={0.3} /></mesh>
      </Appear>
      <Appear on={san && (has('airdry') || has('heatdry'))} position={[0, yc + 0.05, -0.2]}><Fan stageKey={key} heat={has('heatdry')} /></Appear>
      <pointLight ref={light} position={[0, yc + 0.12, 0.12]} color="#cffffa" distance={1.2} intensity={0.03} />
    </group>
  );
}

function Door({ i, row }: { i: number; row: number }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const edge = useRef<THREE.LineBasicMaterial>(null);
  const led = useRef<THREE.MeshBasicMaterial>(null);
  const open = useStore((s) => s.doorOpen[i]);
  const shake = useStore((s) => s.shake);
  const glassy = useStore((s) => s.stage === 'sanitation' && s.locker === i);
  const hl = useStore((s) => (s.stage === 'locker' && s.hover === i) || (s.locker === i && ['service', 'phone', 'payment', 'receipt', 'card', 'placement', 'sanitation'].includes(s.stage)));
  const occ = useStore((s) => s.rentals[i] !== undefined);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.33, 0.58, 0.04)), []);
  const plate = useMemo(() => plateTex(String(i + 1)), [i]);
  const HX = 0.175;

  useEffect(() => { if (g.current) gsap.to(g.current.rotation, { y: open ? 1.95 : 0, duration: T.door, ease: 'power2.inOut' }); }, [open]);
  useEffect(() => {
    if (!g.current || shake.locker !== i) return;
    gsap.fromTo(g.current.position, { x: HX }, { x: HX + 0.012, duration: T.shake, repeat: 7, yoyo: true, ease: 'sine.inOut', onComplete: () => { if (g.current) g.current.position.x = HX; } });
  }, [shake]);
  useFrame(({ clock }) => {
    if (mat.current) { mat.current.opacity += ((glassy ? 0.14 : 1) - mat.current.opacity) * 0.08; mat.current.depthWrite = mat.current.opacity > 0.9; }
    if (edge.current) edge.current.opacity = hl ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 5) : 0;
    // status LED: green free, red in use, blinking amber while the solenoid lock is engaged for sanitation
    if (led.current) led.current.color.set(glassy ? (Math.sin(clock.elapsedTime * 8) > 0 ? '#ffb020' : '#7a4a00') : occ ? '#ff5c5c' : '#3dff9a');
  });

  return (
    <group ref={g} position={[HX, Y[row], FZ + 0.012]}>
      <RoundedBox args={[0.31, 0.54, 0.024]} radius={0.006} smoothness={3} position={[-0.158, 0, 0]} castShadow receiveShadow
        onClick={(e) => { e.stopPropagation(); useStore.getState().doorClick(i); }}
        onPointerOver={(e) => { e.stopPropagation(); if (!open) cursor(true); }} onPointerOut={() => cursor(false)}>
        <meshStandardMaterial ref={mat} color="#6f7b8a" metalness={0.85} roughness={0.32} transparent />
      </RoundedBox>
      <group visible={!glassy}>
        <B p={[-0.275, 0, 0.02]} a={[0.026, 0.1, 0.014]} c="#1d3fb8" e="#3b6bff" ei={0.6} m={0.2} round={0.004} />
        {[0.2, 0.17].map((y) => <B key={y} p={[-0.158, y, 0.016]} a={[0.1, 0.014, 0.008]} c="#cfd6df" m={0.9} r={0.25} />)}
        {[0, 1, 2, 3, 4].map((k) => <B key={k} p={[-0.158, -0.02 - k * 0.022, 0.014]} a={[0.15, 0.007, 0.004]} c="#151a21" m={0.2} />)}
        <mesh position={[-0.158, -0.2, 0.0135]}><planeGeometry args={[0.05, 0.05]} /><meshBasicMaterial map={plate} toneMapped={false} /></mesh>
      </group>
      <mesh position={[-0.04, 0.23, 0.0135]}><circleGeometry args={[0.01, 16]} /><meshBasicMaterial ref={led} color="#3dff9a" toneMapped={false} /></mesh>
      <lineSegments geometry={edges} position={[-0.158, 0, 0.01]}><lineBasicMaterial ref={edge} color={TEAL} transparent opacity={0} toneMapped={false} /></lineSegments>
      {glassy && <Html position={[-0.158, 0.31, 0.03]} center style={{ pointerEvents: 'none' }}><div className="lockchip">🔒 Door locked</div></Html>}
    </group>
  );
}

function Section({ k, on }: { k: number; on: boolean }) {
  return (
    <Appear on={on} position={[towerX(k), 0, 0]}>
      {[0, 1, 2, 3].map((j) => <B key={j} p={[0, j * 0.6 + (j === 3 ? -0.01 : j === 0 ? 0.01 : 0), 0]} a={[0.35, 0.02, 0.45]} c="#222831" />)}
      <B p={[-0.165, 0.9, 0]} a={[0.02, 1.8, 0.45]} c="#2a3039" />
      <B p={[0.165, 0.9, 0]} a={[0.02, 1.8, 0.45]} c="#2a3039" />
      <B p={[0, 0.9, -0.215]} a={[0.35, 1.8, 0.02]} c="#1b2028" />
      {[0, 1, 2].map((r) => <group key={r}><Interior i={k * 3 + r} row={r} /><Door i={k * 3 + r} row={r} /></group>)}
    </Appear>
  );
}
/** Renders as many sections as the configuration defines; removed sections shrink away before unmounting. */
function Cabinet() {
  const n = useDerived().sections;
  const [shown, setShown] = useState(n);
  useEffect(() => {
    if (n > shown) setShown(n);
    else if (n < shown) { const t = window.setTimeout(() => setShown(n), 900); return () => window.clearTimeout(t); }
  }, [n, shown]);
  return <group>{Array.from({ length: shown }, (_, k) => <Section key={k} k={k} on={k < n} />)}</group>;
}

/* ---------- kiosk ---------- */
function Paper() {
  const receipt = useStore((s) => s.receipt);
  const g = useRef<THREE.Group>(null);
  const m = useRef<THREE.Mesh>(null);
  const len = useRef({ v: 0 });
  const tex = useMemo(receiptTex, []);
  useEffect(() => {
    const o = g.current, mm = m.current; if (!o || !mm) return;
    gsap.killTweensOf([o.position, o.scale, len.current]);
    const apply = () => { mm.scale.y = Math.max(len.current.v, 0.0001); mm.position.y = -len.current.v / 2; };
    if (receipt === 'hidden' || receipt === 'collected') { o.visible = false; len.current.v = 0; o.position.set(KX, 0.196, FZ + 0.044); o.scale.setScalar(1); apply(); }
    if (receipt === 'printing') { o.visible = true; gsap.to(len.current, { v: 0.17, duration: T.printMs / 1000, ease: 'steps(14)', onUpdate: apply }); }
    if (receipt === 'ready') { o.visible = true; len.current.v = 0.17; apply(); }
    if (receipt === 'collecting') {
      gsap.timeline({ onComplete: () => { o.visible = false; useStore.getState().receiptCollected(); } })
        .to(o.position, { x: -0.31, y: 0.5, z: 0.75, duration: 0.8, ease: 'power2.inOut' }, 0)
        .to(o.scale, { x: 2.4, y: 2.4, z: 2.4, duration: 0.8, ease: 'power2.inOut' }, 0);
    }
  }, [receipt]);
  return (
    <group ref={g} visible={false} position={[KX, 0.196, FZ + 0.044]}>
      <mesh ref={m} onClick={(e) => { e.stopPropagation(); useStore.getState().collectReceipt(); }} onPointerOver={() => receipt === 'ready' && cursor(true)} onPointerOut={() => cursor(false)}>
        <boxGeometry args={[0.06, 1, 0.001]} />
        {[0, 1, 2, 3, 5].map((k) => <meshStandardMaterial key={k} attach={`material-${k}`} color="#f2f2ec" />)}
        <meshStandardMaterial attach="material-4" map={tex} roughness={0.9} />
      </mesh>
      {receipt === 'ready' && <Html position={[0.09, -0.08, 0.02]} center style={{ pointerEvents: 'none' }}><div className="finger"><span>👆</span>Click to tear off</div></Html>}
    </group>
  );
}

function Kiosk() {
  const stage = useStore((s) => s.stage);
  const hw = useConfig((s) => s.active.hardware);
  const coinOn = useConfig((s) => s.active.payment.coin);
  const idle = stage === 'idle';
  const m = useRef<THREE.MeshBasicMaterial>(null);
  const plate = useMemo(() => labelTex('HELMLOCK V2', '#2ee6d0', 56), []);
  const coinT = useMemo(() => labelTex('COIN', '#9fb2c8', 44), []);
  const cardT = useMemo(() => labelTex('CARD', '#9fb2c8', 44), []);
  const rcptT = useMemo(() => labelTex('RECEIPT', '#9fb2c8', 44), []);
  const [la, lb] = SCREENS[stage];
  const screen = getScreen(la, lb);
  const coinHint = useStore((s) => s.stage === 'payment' && s.method === 'coin' && !s.paid);
  useFrame(({ clock }) => { if (m.current) m.current.color.setScalar(idle ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 2.2) : 0.9); });
  return (
    <group>
      <B p={[KX, 0.5, 0]} a={[0.35, 1.0, 0.45]} c="#262c35" round={0.012} />
      <B p={[KX, 1.006, 0]} a={[0.36, 0.012, 0.46]} c="#8a95a3" m={0.9} r={0.3} round={0.005} />
      <B p={[KX, 0.9, FZ + 0.03]} a={[0.33, 0.02, 0.07]} c="#3a4452" m={0.8} r={0.3} round={0.006} />
      <mesh position={[KX, 0.945, FZ + 0.0015]}><planeGeometry args={[0.26, 0.065]} /><meshBasicMaterial map={plate} transparent toneMapped={false} /></mesh>
      {/* touchscreen */}
      <B p={[KX, 0.78, FZ + 0.006]} a={[0.3, 0.2, 0.014]} c="#0a0d12" m={0.3}
        onClick={(e) => { e.stopPropagation(); useStore.getState().screenClick(); }}
        onPointerOver={() => idle && cursor(true)} onPointerOut={() => cursor(false)} />
      <mesh position={[KX, 0.78, FZ + 0.0135]}><planeGeometry args={[0.27, 0.168]} /><meshBasicMaterial ref={m} map={screen} toneMapped={false} /></mesh>
      {/* coin acceptor + coin return cup */}
      <Appear on={coinOn} position={[KX, 0.58, 0]}>
        <B p={[0, 0, FZ + 0.01]} a={[0.1, 0.14, 0.03]} c="#1a1f27" round={0.004} />
        <B p={[0, 0.02, 0.25]} a={[0.006, 0.04, 0.006]} c="#000" e={TEAL} ei={1.6} />
        <mesh position={[0.07, -0.01, FZ + 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.018, 0.018, 0.03, 20]} /><meshStandardMaterial color="#0b6f66" emissive={TEAL} emissiveIntensity={0.35} metalness={0.6} roughness={0.3} /></mesh>
        <mesh position={[0, -0.06, FZ + 0.0261]}><planeGeometry args={[0.07, 0.02]} /><meshBasicMaterial map={coinT} transparent toneMapped={false} /></mesh>
        <mesh position={[0, 0, 0.28]} onClick={(e) => { e.stopPropagation(); useStore.getState().insertCoin(); }} onPointerOver={() => coinHint && cursor(true)} onPointerOut={() => cursor(false)}>
          <boxGeometry args={[0.13, 0.17, 0.1]} /><meshBasicMaterial visible={false} />
        </mesh>
        {coinHint && <Html position={[0, -0.11, 0.3]} center style={{ pointerEvents: 'none' }}><div className="finger"><span>👆</span>Insert coins here</div></Html>}
      </Appear>
      {/* NFC card dispenser + reader */}
      <Appear on={hw.nfc} position={[KX, 0.36, 0]}>
        <B p={[0, 0, FZ + 0.01]} a={[0.13, 0.05, 0.03]} c="#1a1f27" round={0.004} />
        <B p={[0, 0, FZ + 0.0265]} a={[0.1, 0.008, 0.004]} c="#000" e={TEAL} ei={1.6} />
        <mesh position={[0, -0.05, FZ + 0.0261]}><planeGeometry args={[0.07, 0.02]} /><meshBasicMaterial map={cardT} transparent toneMapped={false} /></mesh>
      </Appear>
      {/* receipt printer */}
      <Appear on={hw.receiptPrinter} position={[KX, 0.2, 0]}>
        <B p={[0, 0, FZ + 0.015]} a={[0.14, 0.07, 0.04]} c="#1a1f27" round={0.004} />
        <B p={[0, -0.004, FZ + 0.0355]} a={[0.1, 0.008, 0.004]} c="#000" e={TEAL} ei={1.2} />
        <mesh position={[0, 0.058, FZ + 0.0361]}><planeGeometry args={[0.07, 0.02]} /><meshBasicMaterial map={rcptT} transparent toneMapped={false} /></mesh>
      </Appear>
      {hw.receiptPrinter && <Paper />}
    </group>
  );
}

/* ---------- animated props ---------- */
function Coins() {
  const coins = useStore((s) => s.coins);
  const service = useStore((s) => s.service);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const prev = useRef(0);
  useEffect(() => {
    if (coins === 0) { refs.current.forEach((g) => g && (g.visible = false)); prev.current = 0; return; }
    if (coins > prev.current) {
      const g = refs.current[coins - 1];
      if (g) {
        g.visible = true; g.position.set(KX, 0.68, 0.6); g.rotation.set(0, 0, 0);
        gsap.timeline({ onComplete: () => { g.visible = false; } })
          .to(g.position, { y: COIN_SLOT[1], z: COIN_SLOT[2] + 0.015, duration: T.coin * 0.75, ease: 'power2.in' }, 0)
          .to(g.rotation, { x: Math.PI * 5, duration: T.coin * 0.75, ease: 'none' }, 0)
          .to(g.position, { z: COIN_SLOT[2] - 0.03, duration: T.coin * 0.25, ease: 'power1.out' });
      }
    }
    prev.current = coins;
  }, [coins]);
  return (
    <>
      {coinsOf(service).map((v, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el; }} visible={false}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[v >= 10 ? 0.014 : 0.011, v >= 10 ? 0.014 : 0.011, 0.003, 28]} />
            <meshStandardMaterial color={v >= 10 ? '#e0b64a' : '#c9ced6'} metalness={1} roughness={0.25} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function AccessCard() {
  const card = useStore((s) => s.card);
  const g = useRef<THREE.Group>(null);
  const tex = useMemo(cardTex, []);
  useEffect(() => {
    const o = g.current; if (!o) return;
    gsap.killTweensOf([o.position, o.rotation, o.scale]);
    if (card === 'hidden' || card === 'collected') { o.visible = false; o.position.set(KX, 0.36, 0.215); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }
    if (card === 'out') { o.visible = true; gsap.to(o.position, { z: 0.34, duration: T.card, ease: 'power2.out' }); }
    if (card === 'collecting') {
      gsap.timeline({ onComplete: () => { o.visible = false; useStore.getState().cardCollected(); } })
        .to(o.position, { x: -0.31, y: 0.58, z: 0.7, duration: 0.9, ease: 'power2.inOut' }, 0)
        .to(o.rotation, { x: Math.PI / 2, duration: 0.9, ease: 'power2.inOut' }, 0)
        .to(o.scale, { x: 2.4, y: 2.4, z: 2.4, duration: 0.9 }, 0)
        .to(o.position, { z: 0.8, duration: 0.3 });
    }
  }, [card]);
  return (
    <group ref={g} visible={false} position={[KX, 0.36, 0.215]}>
      <mesh castShadow onClick={(e) => { e.stopPropagation(); useStore.getState().collectCard(); }} onPointerOver={() => cursor(true)} onPointerOut={() => cursor(false)}>
        <boxGeometry args={[0.086, 0.002, 0.054]} />
        {[0, 1, 3, 4, 5].map((k) => <meshStandardMaterial key={k} attach={`material-${k}`} color="#1c6f69" />)}
        <meshStandardMaterial attach="material-2" map={tex} roughness={0.35} />
      </mesh>
      {card === 'out' && <Html position={[0, 0.04, 0.05]} center style={{ pointerEvents: 'none' }}><div className="finger"><span>👆</span>Click to collect</div></Html>}
    </group>
  );
}

function Helmet() {
  const helmet = useStore((s) => s.helmet);
  const locker = useStore((s) => s.locker);
  const g = useRef<THREE.Group>(null);
  useEffect(() => {
    const o = g.current; if (!o || locker === null) return;
    const [lx, yc] = lockerPos(locker);
    gsap.killTweensOf([o.position, o.scale]);
    if (helmet === 'offered') { o.position.set(lx, yc - 0.02, 0.8); o.scale.setScalar(0.01); gsap.to(o.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)' }); }
    if (helmet === 'inside') { o.position.set(lx, yc - 0.145, 0.02); o.scale.setScalar(1); }
    if (helmet === 'placing') {
      gsap.timeline()
        .to(o.position, { y: yc - 0.03, z: 0.3, duration: T.helmet * 0.5, ease: 'power2.inOut' })
        .to(o.position, { y: yc - 0.145, z: 0.02, duration: T.helmet * 0.5, ease: 'power2.out', onComplete: () => useStore.getState().helmetPlaced() });
    }
    if (helmet === 'removing') {
      gsap.timeline({ onComplete: () => useStore.getState().helmetRemoved() })
        .to(o.position, { y: yc, z: 0.35, duration: T.helmet * 0.45, ease: 'power2.inOut' })
        .to(o.position, { x: lx + 0.025, y: yc + 0.1, z: 1.0, duration: T.helmet * 0.7, ease: 'power2.inOut' })
        .to(o.scale, { x: 1.6, y: 1.6, z: 1.6, duration: T.helmet * 0.7 }, '<');
    }
  }, [helmet, locker]);
  const click = useStore((s) => (s.helmet === 'offered' || (s.helmet === 'inside' && s.ret === 'ready' && s.stage === 'retrieval')));
  const visible = helmet !== 'hidden' && helmet !== 'gone';
  return (
    <group ref={g} visible={visible} position={[towerX(0), 0.9, 0.02]}
      onClick={(e) => { e.stopPropagation(); const s = useStore.getState(); if (s.helmet === 'offered') s.placeHelmet(); else s.takeHelmet(); }}
      onPointerOver={() => click && cursor(true)} onPointerOut={() => cursor(false)}>
      <mesh scale={[1, 0.95, 1.12]} castShadow><sphereGeometry args={[0.13, 32, 24]} /><meshStandardMaterial color="#10192b" metalness={0.5} roughness={0.2} /></mesh>
      <mesh scale={[1, 0.95, 1.12]}><sphereGeometry args={[0.134, 32, 16, Math.PI / 2 - 0.75, 1.5, 1.05, 0.6]} /><meshStandardMaterial color="#38e6d2" metalness={0.9} roughness={0.08} emissive="#0b6f66" emissiveIntensity={0.5} /></mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} scale={[1.12, 0.95, 1]}><torusGeometry args={[0.133, 0.008, 8, 48, Math.PI]} /><meshStandardMaterial color="#2ee6d0" emissive="#2ee6d0" emissiveIntensity={0.8} /></mesh>
      <mesh position={[0, -0.115, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.1, 1]}><torusGeometry args={[0.105, 0.01, 8, 32]} /><meshStandardMaterial color="#1b2740" metalness={0.6} roughness={0.35} /></mesh>
      <B p={[0, -0.1, 0.1]} a={[0.11, 0.045, 0.07]} c="#0c1220" m={0.3} round={0.01} />
      {click && helmet === 'offered' && <Html position={[0, 0.24, 0]} center style={{ pointerEvents: 'none' }}><div className="finger"><span>👆</span>Click to place</div></Html>}
      {click && helmet === 'inside' && <Html position={[0, 0.24, 0]} center style={{ pointerEvents: 'none' }}><div className="finger"><span>👆</span>Click to take</div></Html>}
    </group>
  );
}

/** Per-stage look of the sanitation cycle (keyed by stage, so any configured order works). */
const FX: Record<StageKey, { color: string; size: number; op: number; speed: number; drift: number; light: string; li: number; beam: number }> = {
  uv: { color: '#b99bff', size: 0.02, op: 0, speed: 0.02, drift: 0, light: '#8b5cff', li: 3.5, beam: 0.2 },
  fogging: { color: '#cfefff', size: 0.1, op: 0.32, speed: 0.07, drift: 0.03, light: '#7fe9ff', li: 1.0, beam: 0 },
  misting: { color: '#d8f4ff', size: 0.05, op: 0.25, speed: 0.12, drift: 0.05, light: '#7fe9ff', li: 0.8, beam: 0 },
  ozone: { color: '#a9ffd0', size: 0.045, op: 0.9, speed: 0.03, drift: 0.22, light: '#6dffb8', li: 1.6, beam: 0 },
  airdry: { color: '#e8f6ff', size: 0.025, op: 0.7, speed: 0.55, drift: 0.02, light: '#cfe8ff', li: 1.2, beam: 0 },
  heatdry: { color: '#ffb36b', size: 0.03, op: 0.9, speed: 0.5, drift: 0, light: '#ff8a3d', li: 2.2, beam: 0 },
};
function SanitizeFX() {
  const l = useStore((s) => s.locker);
  const key = useStageKey(l ?? -1);
  const pts = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const N = 220;
  const sprites = useMemo(() => [spriteTex(false), spriteTex(true)], []);
  const data = useMemo(() => {
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { a[i * 3] = (Math.random() - 0.5) * 0.28; a[i * 3 + 1] = Math.random() * 0.5; a[i * 3 + 2] = (Math.random() - 0.5) * 0.38; }
    return a;
  }, []);
  const cur = useRef({ size: 0.02, op: 0, li: 0, beam: 0, color: new THREE.Color('#b99bff'), lcolor: new THREE.Color('#8b5cff') });
  const tc = useMemo(() => new THREE.Color(), []);
  useFrame((st, d) => {
    const on = key !== '', p = FX[key || 'uv'], c = cur.current, k = Math.min(1, d * 3);
    c.size += (p.size - c.size) * k; c.op += ((on ? p.op : 0) - c.op) * k; c.li += ((on ? p.li : 0) - c.li) * k; c.beam += ((on ? p.beam : 0) - c.beam) * k;
    c.color.lerp(tc.set(p.color), k); c.lcolor.lerp(tc.set(p.light), k);
    if (mat.current) {
      mat.current.size = c.size; mat.current.opacity = c.op; mat.current.color.copy(c.color);
      const want = key === 'ozone' ? sprites[1] : sprites[0];
      if (mat.current.map !== want) { mat.current.map = want; mat.current.needsUpdate = true; }
    }
    if (beam.current) beam.current.opacity = c.beam;
    if (light.current) { light.current.intensity = c.li; light.current.color.copy(c.lcolor); }
    const pp = pts.current; if (!pp) return;
    const arr = pp.geometry.attributes.position.array as Float32Array, t = st.clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      arr[i * 3 + 1] += d * p.speed * (0.6 + (i % 5) * 0.2);
      if (arr[i * 3 + 1] > 0.52) arr[i * 3 + 1] = 0;
      arr[i * 3] += Math.sin(t * 1.5 + i) * p.drift * d;
      arr[i * 3] = ((((arr[i * 3] + 0.14) % 0.28) + 0.28) % 0.28) - 0.14;
    }
    pp.geometry.attributes.position.needsUpdate = true;
  });
  if (l === null) return null;
  const [lx, yc] = lockerPos(l);
  return (
    <group position={[lx, yc - 0.27, 0]}>
      <points ref={pts}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[data, 3]} /></bufferGeometry>
        <pointsMaterial ref={mat} map={sprites[0]} color="#b99bff" size={0.02} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <mesh position={[0, 0.27, 0]}><boxGeometry args={[0.25, 0.52, 0.38]} /><meshBasicMaterial ref={beam} color="#8b5cff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <pointLight ref={light} position={[0, 0.5, 0.05]} color="#8b5cff" intensity={0} distance={1} />
    </group>
  );
}

/** Spec markers on the showcase view (toggle with the Hotspots button or the H key). Built from the active configuration. */
function Hotspots() {
  const on = useStore((s) => s.hotspots && s.stage === 'idle');
  const d = useDerived();
  const hw = useConfig((s) => s.active.hardware);
  const coin = useConfig((s) => s.active.payment.coin);
  if (!on) return null;
  const has = (k: StageKey) => d.stages.some((s) => s.key === k);
  const spots: { p: [number, number, number]; t: string; d: string }[] = [];
  const san = d.lockers.find((l) => l.sanitation);
  if (san) {
    const [x, y] = lockerPos(san.index);
    spots.push({ p: [x, y + 0.27, FZ + 0.12], t: 'UV-C lamp', d: 'Fixed first stage of every cycle' });
    if (has('fogging') || has('misting')) spots.push({ p: [x, y - 0.25, FZ + 0.12], t: 'Ultrasonic mist maker', d: 'Misting / fogging with solution reservoir' });
    if (has('ozone')) spots.push({ p: [x - 0.1, y + 0.2, FZ + 0.12], t: 'Ozone module', d: 'Ozone treatment stage' });
    if (has('airdry') || has('heatdry')) spots.push({ p: [x, y + 0.02, FZ + 0.12], t: has('heatdry') ? 'Heater fan' : 'Air-drying fan', d: 'Drying is always the last stage' });
    spots.push({ p: [x - 0.085, y, FZ + 0.1], t: '12V solenoid lock', d: 'Locks the door during the cycle' });
  }
  spots.push({ p: [KX, 0.78, FZ + 0.1], t: '11.6" HDMI LCD touchscreen', d: 'Customer interface' });
  if (coin) spots.push({ p: [KX, 0.6, FZ + 0.1], t: 'Coin acceptor', d: 'Universal coin acceptor' });
  if (hw.nfc) spots.push({ p: [KX, 0.36, FZ + 0.1], t: 'NFC card dispenser + reader', d: 'Issues and reads the access card' });
  if (hw.receiptPrinter) spots.push({ p: [KX, 0.2, FZ + 0.1], t: 'Receipt printer', d: 'Transaction or retrieval receipts' });
  return (
    <>
      {spots.map((s) => (
        <Html key={s.t} position={s.p} center zIndexRange={[8, 0]}>
          <button className="hs" aria-label={s.t}><i /><span><b>{s.t}</b>{s.d}</span></button>
        </Html>
      ))}
    </>
  );
}

/* ---------- camera ---------- */
const Y_AXIS = new THREE.Vector3(0, 1, 0);
function Rig() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; enabled: boolean; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const id = useStore(viewId);
  const intro = useStore((s) => s.intro);
  const n = useDerived().sections;
  const prev = useRef('');
  const sway = useRef({ base: new THREE.Vector3(), tmp: new THREE.Vector3(), on: false });
  useEffect(() => {
    if (!controls) return;
    camera.position.set(3.4, 2.4, 6.2); controls.target.set(0, 0.9, 0); controls.update(); sfx.whoosh();
  }, [intro, controls]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { sway.current.on = false; };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);
  useEffect(() => {
    if (!controls) return;
    if (prev.current && prev.current !== id) sfx.whoosh();
    prev.current = id;
    const v = viewFor(id, n);
    sway.current.on = false;
    gsap.killTweensOf([camera.position, controls.target]);
    controls.enabled = false;
    const d = id === 'showcase' ? 2.8 : T.camera;
    gsap.to(camera.position, { x: v.pos[0], y: v.pos[1], z: v.pos[2], duration: d, ease: 'power3.inOut' });
    gsap.to(controls.target, {
      x: v.target[0], y: v.target[1], z: v.target[2], duration: d, ease: 'power3.inOut', onUpdate: () => controls.update(),
      onComplete: () => { controls.enabled = v.free; if (v.free) { sway.current.base.copy(camera.position).sub(controls.target); sway.current.on = true; } },
    });
  }, [id, controls, intro, n]);
  // gentle turntable sway on the showcase view until the user grabs the cabinet
  useFrame(({ clock }) => {
    const s = sway.current;
    if (!s.on || !controls) return;
    s.tmp.copy(s.base).applyAxisAngle(Y_AXIS, 0.4 * Math.sin(clock.elapsedTime * 0.35));
    camera.position.copy(controls.target).add(s.tmp);
    controls.update();
  });
  return null;
}

export default function Scene() {
  const nfc = useConfig((s) => s.active.hardware.nfc);
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 40, position: [3.4, 2.4, 6.2], near: 0.05, far: 60 }}>
      <color attach="background" args={['#06090f']} />
      <fog attach="fog" args={['#06090f', 8, 18]} />
      <ambientLight intensity={0.35} />
      <spotLight position={[2.5, 4.5, 3.5]} angle={0.55} penumbra={1} intensity={160} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
      <directionalLight position={[-3, 2, 2.5]} intensity={0.6} color="#7fe9ff" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2.2} position={[0, 4, 3]} scale={[9, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#2ee6d0" position={[-4, 1.5, 1]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#6b8cff" position={[4, 2, -2]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} />
      </Environment>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <MeshReflectorMaterial blur={[300, 100]} resolution={512} mixBlur={1} mixStrength={35} roughness={1} depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.3} color="#0b1018" metalness={0.5} mirror={0} />
      </mesh>
      <ContactShadows position={[0.4, 0.002, 0]} opacity={0.6} scale={8} blur={2.4} far={1.5} />
      <group>
        <Kiosk /><Cabinet />
        <Helmet />{nfc && <AccessCard />}<Coins /><SanitizeFX /><Hotspots />
      </group>
      <OrbitControls makeDefault enablePan={false} enableDamping minDistance={0.8} maxDistance={9} maxPolarAngle={Math.PI / 2 - 0.04} />
      <Rig />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.7} luminanceThreshold={0.9} luminanceSmoothing={0.25} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  );
}
