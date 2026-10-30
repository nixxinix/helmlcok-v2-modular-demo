
/** Single source of truth for the modular system: types, defaults, validation, derivation and persistence. */

import { useMemo } from 'react';
import { create } from 'zustand';

export type CleanKey = 'ozone' | 'misting' | 'fogging';
export type DryKey = 'airdry' | 'heatdry';
export type StageKey = 'uv' | CleanKey | DryKey;
export type Group = 'uv' | 'clean' | 'dry';
export type RetrievalMethod = 'nfc' | 'otp' | 'qr' | 'code';
export type SectionType = 'locker' | 'sanitation';

export interface StageCfg {
  key: StageKey;
  label: string;
  detail: string;
  seconds: number;
}

export interface SystemConfig {
  hardware: {
    receiptPrinter: boolean;
    nfc: boolean;
    otp: boolean;
    sanitation: boolean;
  };
  receipt: {
    type: 'transaction' | 'retrieval';
    qr: boolean;
    code: boolean;
  };
  otp: {
    verify: boolean;
    ttlSeconds: number;
    maxAttempts: number;
  };
  codeTtlMinutes: number;
  payment: {
    coin: boolean;
    qr: boolean;
  };
  sections: SectionType[];
  stages: StageCfg[];
}

export const MAX_SECTIONS = 4;
export const PER_SECTION = 3;

export const STAGE_INFO: Record<
  StageKey,
  { label: string; detail: string; group: Group }
> = {
  uv: {
    label: 'UV-C',
    detail: 'UV-C lamp sweeps the compartment.',
    group: 'uv',
  },
  ozone: {
    label: 'Ozone',
    detail: 'Ozone treatment circulates.',
    group: 'clean',
  },
  misting: {
    label: 'Misting',
    detail: 'Fine mist wets the surfaces.',
    group: 'clean',
  },
  fogging: {
    label: 'Fogging',
    detail: 'Ultrasonic fog fills the compartment.',
    group: 'clean',
  },
  airdry: {
    label: 'Air drying',
    detail: 'Fan-driven airflow dries the interior.',
    group: 'dry',
  },
  heatdry: {
    label: 'Heat drying',
    detail: 'Heated airflow dries the interior.',
    group: 'dry',
  },
};

export const CLEAN_KEYS: CleanKey[] = [
  'ozone',
  'misting',
  'fogging',
];

export const DRY_KEYS: DryKey[] = [
  'airdry',
  'heatdry',
];

export const METHOD_LABEL: Record<RetrievalMethod, string> = {
  nfc: 'NFC card',
  otp: 'Phone OTP',
  qr: 'Receipt QR code',
  code: 'Receipt access code',
};

export const mkStage = (
  key: StageKey,
  seconds = 4
): StageCfg => ({
  key,
  label: STAGE_INFO[key].label,
  detail: STAGE_INFO[key].detail,
  seconds,
});

export const DEFAULT_CONFIG: SystemConfig = {
  hardware: {
    receiptPrinter: false,
    nfc: true,
    otp: false,
    sanitation: true,
  },

  receipt: {
    type: 'retrieval',
    qr: true,
    code: true,
  },

  otp: {
    verify: true,
    ttlSeconds: 120,
    maxAttempts: 3,
  },

  codeTtlMinutes: 1440,

  payment: {
    coin: true,
    qr: true,
  },

  sections: ['sanitation'],

  stages: [
    mkStage('uv'),
    mkStage('fogging'),
    mkStage('ozone'),
    mkStage('airdry'),
  ],
};

const clone = <T,>(v: T): T =>
  JSON.parse(JSON.stringify(v));

export const defaults = (): SystemConfig =>
  clone(DEFAULT_CONFIG);

/** Enforces the strict sequence: UV-C first, cleaning in the middle, drying last. */
export function normalizeStages(stages: StageCfg[]): StageCfg[] {
  const valid = stages.filter(
    (s) => s && STAGE_INFO[s.key]
  );

  const uv =
    valid.find((s) => s.key === 'uv') ?? mkStage('uv');

  const seen = new Set<StageKey>();

  const clean = valid.filter(
    (s) =>
      STAGE_INFO[s.key].group === 'clean' &&
      !seen.has(s.key) &&
      !!seen.add(s.key)
  );

  const dry = DRY_KEYS
    .map((k) => valid.find((s) => s.key === k))
    .filter((s): s is StageCfg => !!s);

  return [uv, ...clean, ...dry];
}

/** Returns all enabled retrieval methods. */
export function retrievalMethods(
  c: SystemConfig
): RetrievalMethod[] {
  const m: RetrievalMethod[] = [];

  if (c.hardware.nfc) m.push('nfc');
  if (c.hardware.otp) m.push('otp');

  const rr =
    c.hardware.receiptPrinter &&
    c.receipt.type === 'retrieval';

  if (rr && c.receipt.qr) m.push('qr');
  if (rr && c.receipt.code) m.push('code');

  return m;
}

/** Display the correct label depending on OTP verification settings. */
export const methodLabel = (
  m: RetrievalMethod,
  verify = true
) =>
  m === 'otp' && !verify
    ? 'Phone number'
    : METHOD_LABEL[m];

/**
 * Retrieval priority:
 * 1. NFC is always primary when enabled.
 * 2. Without NFC, receipt retrieval is primary.
 * 3. Phone retrieval is emergency when receipt is enabled.
 * 4. Phone is primary when it is the only enabled method.
 */
export function retrievalPlan(
  c: SystemConfig
): {
  primary: RetrievalMethod[];
  emergency: RetrievalMethod[];
} {
  const all = retrievalMethods(c);

  const tier = (m: RetrievalMethod) =>
    m === 'nfc' ? 0 : m === 'otp' ? 2 : 1;

  const top = Math.min(9, ...all.map(tier));

  return {
    primary: all.filter((m) => tier(m) === top),
    emergency: all.filter((m) => tier(m) !== top),
  };
}

export function validateConfig(c: SystemConfig) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (
    c.sections.length < 1 ||
    c.sections.length > MAX_SECTIONS
  ) {
    errors.push(
      `Use 1 to ${MAX_SECTIONS} locker sections.`
    );
  }

  if (
    c.sections.some(
      (t) => t !== 'locker' && t !== 'sanitation'
    )
  ) {
    errors.push('Unknown section type.');
  }

  if (c.hardware.sanitation) {
    const st = c.stages;
    const keys = st.map((s) => s.key);

    if (st[0]?.key !== 'uv') {
      errors.push('UV-C must be the first sanitation stage.');
    }

    if (keys.filter((k) => k === 'uv').length !== 1) {
      errors.push('UV-C must appear exactly once.');
    }

    if (new Set(keys).size !== keys.length) {
      errors.push('Sanitation stages cannot repeat.');
    }

    const order = st.map((s) =>
      STAGE_INFO[s.key]
        ? (['uv', 'clean', 'dry'] as Group[]).indexOf(
            STAGE_INFO[s.key].group
          )
        : -1
    );

    if (
      order.some(
        (o, i) => o < 0 || (i > 0 && o < order[i - 1])
      )
    ) {
      errors.push(
        'Order must be UV-C, then cleaning procedures, then drying.'
      );
    }

    if (
      !st.some(
        (s) => STAGE_INFO[s.key]?.group === 'dry'
      )
    ) {
      errors.push(
        'Add at least one drying method (air or heat). Drying is always the last stage.'
      );
    }

    st.forEach((s) => {
      if (
        !Number.isInteger(s.seconds) ||
        s.seconds < 1 ||
        s.seconds > 60
      ) {
        errors.push(
          `${s.label || s.key}: duration must be 1 to 60 seconds.`
        );
      }

      if (!s.label.trim()) {
        errors.push(`Stage "${s.key}" needs a label.`);
      }
    });
  } else if (c.sections.includes('sanitation')) {
    warnings.push(
      'Sanitation module is off, so sanitation sections behave as basic lockers.'
    );
  }

  if (
    c.hardware.receiptPrinter &&
    c.receipt.type === 'retrieval' &&
    !c.receipt.qr &&
    !c.receipt.code
  ) {
    errors.push(
      'A retrieval receipt needs a QR code, an access code, or both.'
    );
  }

  const methods = retrievalMethods(c);

  if (!methods.length) {
    errors.push(
      'Enable at least one retrieval method: NFC, OTP, or a retrieval receipt.'
    );
  }

  if (!c.payment.coin && !c.payment.qr) {
    errors.push('Enable at least one payment option.');
  }

  if (
    c.otp.ttlSeconds < 30 ||
    c.otp.ttlSeconds > 600
  ) {
    errors.push('OTP lifetime must be 30 to 600 seconds.');
  }

  if (
    c.otp.maxAttempts < 1 ||
    c.otp.maxAttempts > 10
  ) {
    errors.push('OTP attempts must be 1 to 10.');
  }

  if (
    c.codeTtlMinutes < 1 ||
    c.codeTtlMinutes > 10080
  ) {
    errors.push(
      'Access code validity must be 1 to 10080 minutes.'
    );
  }

  if (
    c.hardware.receiptPrinter &&
    c.receipt.type === 'transaction'
  ) {
    warnings.push(
      'Transaction receipts are records only and never authorize retrieval.'
    );
  }

  const plan = retrievalPlan(c);
  const nm = (m: RetrievalMethod) =>
    methodLabel(m, c.otp.verify);

  if (plan.emergency.length) {
    warnings.push(
      `Primary retrieval: ${plan.primary.map(nm).join(' / ')}. Emergency only: ${plan.emergency.map(nm).join(' / ')}.`
    );
  }

  if (c.hardware.otp && !c.otp.verify) {
    warnings.push(
      'OTP verification is off: only the phone number is checked. A mistyped number at rental can make retrieval impossible.'
    );
  }

  return { errors, warnings };
}

export interface LockerInfo {
  index: number;
  section: number;
  row: number;
  sanitation: boolean;
}

export function derive(c: SystemConfig) {
  const lockers: LockerInfo[] = [];

  c.sections.forEach((t, k) => {
    for (let r = 0; r < PER_SECTION; r++) {
      lockers.push({
        index: k * PER_SECTION + r,
        section: k,
        row: r,
        sanitation:
          c.hardware.sanitation && t === 'sanitation',
      });
    }
  });

  const payMethods = [
    c.payment.coin && 'coin',
    c.payment.qr && 'qr',
  ].filter(Boolean) as ('coin' | 'qr')[];

  return {
    sections: c.sections.length,
    total: lockers.length,
    lockers,
    methods: retrievalMethods(c),
    plan: retrievalPlan(c),
    stages: c.hardware.sanitation ? c.stages : [],
    payMethods,
  };
}

export const totalSeconds = (stages: StageCfg[]) =>
  stages.reduce((a, b) => a + b.seconds, 0);

/** Stage index and in-stage progress for a 0..1 cycle progress value. */
export function sanitationAt(
  p: number,
  stages: StageCfg[]
) {
  let t =
    Math.min(1, Math.max(0, p)) * totalSeconds(stages);

  for (let i = 0; i < stages.length; i++) {
    if (
      t < stages[i].seconds ||
      i === stages.length - 1
    ) {
      return {
        index: i,
        within: Math.min(1, t / stages[i].seconds),
      };
    }

    t -= stages[i].seconds;
  }

  return { index: 0, within: 0 };
}

interface RentalLike {
  service: string;
  cardId?: string;
  phone?: string;
  qrToken?: string;
  accessCode?: string;
}

/** Reasons a new configuration must not be applied right now. */
export function checkApply(
  next: SystemConfig,
  rentals: Record<number, RentalLike>,
  stage: string
): string[] {
  const errs: string[] = [];
  const d = derive(next);

  if (!['idle', 'completed'].includes(stage)) {
    errs.push(
      'Finish or exit the current customer session before applying changes.'
    );
  }

  const rr =
    next.hardware.receiptPrinter &&
    next.receipt.type === 'retrieval';

  Object.entries(rentals).forEach(([k, r]) => {
    const i = Number(k);

    if (i >= d.total) {
      errs.push(
        `Locker ${i + 1} has an active rental, so its section cannot be removed.`
      );
      return;
    }

    if (
      r.service === 'sanitize' &&
      !d.lockers[i].sanitation
    ) {
      errs.push(
        `Locker ${i + 1} has an active sanitation rental, so keep its section as Locker with Sanitation.`
      );
    }

    const ok =
      (next.hardware.nfc && r.cardId) ||
      (next.hardware.otp && r.phone) ||
      (rr && next.receipt.qr && r.qrToken) ||
      (rr && next.receipt.code && r.accessCode);

    if (!ok) {
      errs.push(
        `Locker ${i + 1}'s helmet could no longer be retrieved with the enabled methods.`
      );
    }
  });

  return errs;
}

/* ---------- persistence + runtime validation of stored JSON ---------- */

const KEY = 'helmlock.config.v2';

export function sanitizeConfig(raw: unknown): SystemConfig {
  const d = defaults();

  if (!raw || typeof raw !== 'object') return d;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as Record<string, any>;

  const bool = (v: unknown, f: boolean) =>
    typeof v === 'boolean' ? v : f;

  const num = (v: unknown, f: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : f;

  const hw = r.hardware ?? {};
  const rc = r.receipt ?? {};
  const ot = r.otp ?? {};
  const py = r.payment ?? {};

  const cfg: SystemConfig = {
    hardware: {
      receiptPrinter: bool(
        hw.receiptPrinter,
        d.hardware.receiptPrinter
      ),
      nfc: bool(hw.nfc, d.hardware.nfc),
      otp: bool(hw.otp, d.hardware.otp),
      sanitation: bool(
        hw.sanitation,
        d.hardware.sanitation
      ),
    },

    receipt: {
      type:
        rc.type === 'transaction'
          ? 'transaction'
          : 'retrieval',
      qr: bool(rc.qr, d.receipt.qr),
      code: bool(rc.code, d.receipt.code),
    },

    otp: {
      verify: bool(ot.verify, d.otp.verify),
      ttlSeconds: num(
        ot.ttlSeconds,
        d.otp.ttlSeconds
      ),
      maxAttempts: num(
        ot.maxAttempts,
        d.otp.maxAttempts
      ),
    },

    codeTtlMinutes: num(
      r.codeTtlMinutes,
      d.codeTtlMinutes
    ),

    payment: {
      coin: bool(py.coin, d.payment.coin),
      qr: bool(py.qr, d.payment.qr),
    },

    sections: Array.isArray(r.sections)
      ? r.sections.map((t: unknown) =>
          t === 'locker' ? 'locker' : 'sanitation'
        )
      : d.sections,

    stages: Array.isArray(r.stages)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? normalizeStages(
          r.stages
            .filter(
              (s: any) =>
                s &&
                typeof s.key === 'string' &&
                s.key in STAGE_INFO
            )
            .map((s: any) => ({
              key: s.key as StageKey,
              label:
                typeof s.label === 'string'
                  ? s.label
                  : STAGE_INFO[s.key as StageKey].label,
              detail:
                typeof s.detail === 'string'
                  ? s.detail
                  : STAGE_INFO[s.key as StageKey].detail,
              seconds: num(s.seconds, 4),
            }))
        )
      : d.stages,
  };

  return validateConfig(cfg).errors.length ? d : cfg;
}

function load(): SystemConfig {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(KEY)
        : null;

    return raw
      ? sanitizeConfig(JSON.parse(raw))
      : defaults();
  } catch {
    return defaults();
  }
}

function save(c: SystemConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

interface CfgState {
  active: SystemConfig;
  draft: SystemConfig;
  setDraft: (f: (c: SystemConfig) => void) => void;
  resetDraft: () => void;
  apply: () => void;
  restoreDefaults: () => void;
}

/** `active` drives the cabinet, kiosk and transaction flow. */
export const useConfig = create<CfgState>((set, get) => {
  const a = load();

  return {
    active: a,
    draft: clone(a),

    setDraft: (f) => {
      const d = clone(get().draft);
      f(d);
      d.stages = normalizeStages(d.stages);
      set({ draft: d });
    },

    resetDraft: () =>
      set({ draft: clone(get().active) }),

    apply: () => {
      const d = clone(get().draft);
      save(d);
      set({ active: d });
    },

    restoreDefaults: () => {
      const d = defaults();
      save(d);
      set({ active: d, draft: clone(d) });
    },
  };
});

export function useDerived() {
  const a = useConfig((s) => s.active);
  return useMemo(() => derive(a), [a]);
}
