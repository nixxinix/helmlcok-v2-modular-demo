# HelmLock V2: Modular Smart Locker Simulator

An interactive 3D simulation of the HelmLock V2 helmet storage and sanitation kiosk. Hardware modules, retrieval methods, sanitation stages and locker sections are **configuration-driven** and can be changed from the in-app **⚙ Admin** panel without editing source code.

Everything is simulated: no real payments, SMS, NFC or hardware control, and no backend. Do not treat the mock credentials as production security.

**Stack:** React, TypeScript, Vite, React Three Fiber, Drei, GSAP, Zustand, `qrcode` (real QR encoding), Vitest.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit + journey tests
npm run build    # type-check + production build
```
Node 18+, desktop browser with WebGL. Use headphones or speakers: the demo has synthesized sound effects (volume slider and mute in the header).

## Admin panel (header: ⚙ Admin, available on the home screen)

| Section | What you can do |
| --- | --- |
| **A. Hardware** | Receipt printer, NFC dispenser/reader, phone + OTP, sanitation module, air-drying, heat-drying, coin and QR payment. Disabled hardware disappears from the 3D scene and its steps disappear from the kiosk. |
| **B. Retrieval and receipts** | Receipt type (transaction = record only, retrieval = credential), QR and/or printed access code, OTP lifetime and attempts, access-code validity. |
| **C. Sanitation** | **Strict order: UV-C (fixed, first) → cleaning procedures (Ozone, Misting, Fogging; add/remove/reorder) → drying (Air and/or Heat, always last).** Edit labels, descriptions and per-stage seconds. The stage count follows the configuration. |
| **D. Lockers** | 1 to 4 sections of 3 lockers each, each set to *Locker Only* or *Locker with Sanitation*, with a live layout preview. |

Changes are validated, previewed, then applied live (the cabinet grows or shrinks with animation). Apply is blocked when it would break something: an active customer session, removing or changing a section that holds a rental, or disabling the only method that can retrieve a stored helmet. Settings persist in the browser (`localStorage`); **Restore defaults** returns to the original 1 × 3 cabinet.

## Customer flow (derived from the active configuration)

`welcome → locker → service → [phone + OTP] → payment → [receipt] → [card] → store helmet → [sanitation] → home → retrieve`

* **Receipts:** animated printer paper. *Transaction* receipts are records only; *retrieval* receipts carry a QR (real QR image of an opaque token, never personal data) and/or an access code.
* **Retrieval:** NFC card tap, OTP by simulated SMS (OTP is a recovery option when other methods exist, primary when alone), receipt QR (simulated scanner, no camera) or receipt access code.
* **Pricing:** Locker Only ₱20, Locker + Sanitation ₱30 (`src/config.ts`).

Presenter keys: **H** hotspots, **S** skip sanitation, **R** restart, **M** mute. Header: speed 1×/1.5×/2×, volume.

## Code map

```
src/system.ts       configuration model, validation, derivation, persistence (source of truth)
src/credentials.ts  credential engine: card, receipt QR, access code, OTP
src/store.ts        transaction engine / state machine
src/Scene.tsx       3D cabinet generated from configuration, animations, camera
src/UI.tsx          kiosk interface    src/Admin.tsx  System Configuration panel
src/config.ts       branding, prices, wallets, timings    src/sound.ts  synthesized sound effects
src/__tests__/      validation, credential and end-to-end journey tests
```

## Tests

`npm test` covers configuration validation (strict UV-C → cleaning → drying order, sections, retrieval methods, safe-apply rules, stored-config repair), credential matching (card, QR, code expiry, OTP lifetime/attempts, transaction-only receipts), and full journeys against the real transaction engine: default NFC, OTP-only, access-code and QR receipts, transaction-only receipt, configurable sanitation stages, basic-section restriction, and restart cleanliness. The 3D rendering itself is not covered by automated browser tests.
