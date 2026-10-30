/** Static demo settings (branding, prices, wallets, timings). Hardware/retrieval/sanitation options live in system.ts and the Admin panel. */
export type ServiceKey = 'locker' | 'sanitize';
export interface Wallet { id: string; name: string; bg: string; fg: string; kind: 'wallet' | 'bank'; /** optional official logo image path (overrides the text badge) */ logo?: string }

export const CONFIG = {
  brand: 'HelmLock V2',
  currency: '₱',
  /** Demo balance shown on the simulated phone before paying. */
  walletBalance: 500,
  wallets: [
    { id: 'gcash', name: 'GCash', bg: '#0a63f2', fg: '#ffffff', kind: 'wallet' },
    { id: 'maya', name: 'Maya', bg: '#0b0f0d', fg: '#2dff8a', kind: 'wallet' },
    { id: 'bdo', name: 'BDO', bg: '#0b3d91', fg: '#ffd23f', kind: 'bank' },
    { id: 'bpi', name: 'BPI', bg: '#b3151c', fg: '#ffffff', kind: 'bank' },
    { id: 'unionbank', name: 'UnionBank', bg: '#f26b21', fg: '#ffffff', kind: 'bank' },
    { id: 'landbank', name: 'Landbank', bg: '#0e7a3b', fg: '#ffffff', kind: 'bank' },
    { id: 'other', name: 'Other Bank', bg: '#334155', fg: '#e8fffb', kind: 'bank' },
  ] as Wallet[],
  /** Animation timing: seconds for GSAP tweens, *Ms keys in milliseconds. */
  timing: {
    camera: 1.4, door: 0.9, coin: 0.8, card: 0.9, helmet: 1.1, shake: 0.05,
    warningMs: 2200, qrPhoneMs: 1100, qrScanMs: 1500, qrProcessMs: 1800, receiptAutoMs: 7000, validateMs: 1100, storedMs: 3000, printMs: 1800,
  },
  /** Price per service and the four coins used to pay it (coins must add up to the price). */
  services: {
    locker: { label: 'Locker Only', desc: 'Secure storage for your helmet behind a locked front door.', price: 20, coins: [5, 5, 5, 5] },
    sanitize: { label: 'Locker + Sanitation', desc: 'Secure storage plus a simulated sanitation cycle while you are away.', price: 30, coins: [10, 10, 5, 5] },
  } as Record<ServiceKey, { label: string; desc: string; price: number; coins: number[] }>,
};

export const priceOf = (s: ServiceKey | null) => CONFIG.services[s ?? 'locker'].price;
export const coinsOf = (s: ServiceKey | null) => CONFIG.services[s ?? 'locker'].coins;

(Object.keys(CONFIG.services) as ServiceKey[]).forEach((k) => {
  const sv = CONFIG.services[k];
  const sum = sv.coins.reduce((a, b) => a + b, 0);
  if (sum !== sv.price || sv.coins.length !== 4) console.warn(`[HelmLock] ${k}: 4 coins must add up to ${sv.price} (got ${sum}).`);
});
