/** Scene geometry (metres). One locker section = 3 stacked lockers (35 x 45 x 180 cm); extra sections sit side by side. */
export const KX = -0.175; // kiosk centre x
export const FZ = 0.225; // front plane z
export const Y = [0.3, 0.9, 1.5]; // locker centre heights (bottom -> top)
export const PITCH = 0.36; // distance between sections
export const towerX = (k: number) => 0.175 + k * PITCH;
export const lockerPos = (i: number): [number, number] => [towerX(Math.floor(i / 3)), Y[i % 3]];
export const COIN_SLOT: [number, number, number] = [KX, 0.6, 0.25];

export interface View { pos: [number, number, number]; target: [number, number, number]; free: boolean }

/** Camera view by id; `n` = number of sections so wide cabinets stay framed. */
export function viewFor(id: string, n = 1): View {
  const [k, s] = id.split(':');
  const [lx, yc] = lockerPos(Number(s) || 0);
  const mid = (KX + towerX(n - 1)) / 2, extra = n - 1;
  switch (k) {
    case 'coin': return { pos: [-0.33, 0.64, 0.95], target: [-0.35, 0.56, 0.2], free: false };
    case 'card': return { pos: [-0.33, 0.62, 0.9], target: [-0.35, 0.4, 0.2], free: false };
    case 'receipt': return { pos: [-0.33, 0.45, 0.9], target: [-0.35, 0.2, 0.2], free: false };
    case 'locker': return { pos: [lx + 0.025, yc + 0.08, 1.35], target: [lx + 0.025, yc - 0.02, 0.1], free: false };
    case 'close': return { pos: [lx + 0.005, yc + 0.03, 0.95], target: [lx, yc - 0.02, 0.1], free: false };
    case 'screen': return { pos: [mid - 0.2, 0.95, 2.5 + extra * 0.6], target: [mid - 0.45 - extra * 0.05, 0.9, 0], free: false };
    default: return { pos: [mid + 1.5 + extra * 0.35, 1.45, 2.9 + extra * 0.7], target: [mid, 0.9, 0], free: true };
  }
}
