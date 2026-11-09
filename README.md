# Budget Tracker v2

A self-contained, offline-first personal finance system featuring a **Catppuccin AMOLED Black blocky aesthetic**, **rolling daily allowance engine**, **multi-pool physical ledger**, **undated envelopes with hard caps**, **unified interpersonal obligations**, **multi-cadence recurrence** (e.g., electricity every 2 months), **arbitrary future date forecasting**, and an **independent Python mathematical audit verification engine**.

---

## Key Features

- **AMOLED Black & Strictly Blocky Design**:
  - True `#000000` pitch-black OLED background with Catppuccin Mocha tokens.
  - Zero rounded corners (`border-radius: 0px !important` strictly everywhere) for a sharp, brutalist, high-contrast UI across mobile and desktop.
- **Rolling Daily Allowance (v1 Formula Preserved)**:
  - Daily allowance adjusts dynamically: $\text{allowance}_i = \frac{B - \text{spent}}{N - i}$.
  - Underspending raises future allowances; overspending lowers them.
- **Multi-Pool Physical Money Tracking**:
  - Tracks real money location (Bank Accounts, Cash, Digital Wallets).
  - Derived from an append-only ledger journal with real-world reconciliation adjustments.
  - Safe pool removal: 1-click transfer remaining balance to another pool before archiving.
- **Undated Envelopes & Hard Caps**:
  - Pre-seeded with Impulse, Petrol, Utilities, Rent, and Misc envelopes.
  - Optional hard caps: blocks purchases if the envelope has been exhausted.
- **Unified Interpersonal Obligations (Bills, Debts, Receivables)**:
  - Single record structure for institutional bills, personal debts, and loans owed to you.
  - Per-person netting: automatically calculates who owes whom.
  - Potential debt tracking with customizable likelihood weighting (0–100%).
- **Multi-Cadence Recurrence & Future Date Horizon Forecaster**:
  - Supports flexible intervals: electricity once every 2 months (`interval: 2, unit: 'months'`), monthly rent, biweekly income, or annual insurance.
  - Select any date in the future (e.g. **Dec 23, Dec 24, ...**) to see projected finances under **Cap (Conservative Worst-Case Floor)** vs. **Pace (Expected Velocity)**.
  - Interactive SVG cash trajectory chart with mouse/touch scrubbers, gradient confidence bands, and upcoming event glyphs.
- **Independent Python Audit Engine (`verify_ledger.py`)**:
  - 1-click export of a standalone, zero-dependency Python 3 audit script embedding your active ledger.
  - Running `python3 verify_ledger.py` independently recalculates every pool balance, budget allowance, shortfall, and projection to prove 100% mathematical parity.
- **Data Portability & Offline Privacy**:
  - Data lives entirely inside local device storage (`localStorage`) partitioned into monthly shards (`YYYY-MM`).
  - Includes 1-click **Export Full Backup (JSON)** and **Restore from Backup (JSON)**.
  - Claude Artifacts `db` sync support when hosted in private per-user clouds.

---

## Quick Start

### 1. Run in Browser (Zero Setup)
Simply double-click or open [`Budget Tracker v2.html`](./Budget%20Tracker%20v2.html) in any web browser. No server, build step, or internet connection is required.

### 2. Run as Native Desktop App (Electron)
Launch a dedicated, frameless native AMOLED desktop window:
```bash
npm install # if not already installed
npm run desktop
```

### 3. Run Automated Tests
Execute the 25-test Node.js test suite and cross-language Python verification:
```bash
npm test
```

### 4. Build from Source
Re-bundle the modular source files into the standalone single-file HTML deliverable:
```bash
npm run build
```

---

## How to Install on Mobile (Mobile App)

Budget Tracker v2 is packaged as an installable **Progressive Web App (PWA)** that launches full-screen without browser address bars:

### Android (Chrome, Brave, Samsung Internet)
1. Transfer [`Budget Tracker v2.html`](./Budget%20Tracker%20v2.html) to your phone (via WhatsApp, Telegram, Google Drive, or USB).
2. Tap to open in Chrome or Brave.
3. Tap the browser menu (**⋮**) in the top-right corner.
4. Select **"Install app"** or **"Add to Home screen"**.
5. The **Budget Tracker** icon will be added to your home screen and app drawer.

### iPhone / iPad (Safari)
1. Transfer [`Budget Tracker v2.html`](./Budget%20Tracker%20v2.html) to your device and save to the **Files** app.
2. Tap the file to open it in **Safari**.
3. Tap the **Share** button (box with an arrow pointing upward).
4. Scroll down and tap **"Add to Home Screen"**.
5. Tap **Add** in the top-right corner.

---

## Core Financial Equations

All balances are derived directly from the append-only ledger:

$$\text{Total Available} = \sum \text{Active Pool Balances}$$

$$\text{Committed} = \sum \max(0, \text{funded} - \text{spent})$$

$$\text{Shortfall}_o = \max(0, \text{unpaid\_due}_o - \text{funded\_remaining}_o) \quad \text{(obligations)}$$

$$\text{Unallocated (Free)} = \text{Total} - \text{Committed} - \sum \text{Shortfall}_{\text{confirmed}}$$

$$\text{Net Position} = \text{Total} + \sum \text{Receivables}_{\text{confirmed}} - \sum \text{Payables}_{\text{confirmed}}$$

> **The Zero-Floor Invariant**: Overspending beyond a budget's funded amount is floored at 0 in Committed, which mathematically reduces Unallocated one-for-one.

---

## Project Structure

```text
money_tracking/
├── Budget Tracker v2.html   # Primary single-file deliverable (~136 KB)
├── electron-main.cjs        # Native Electron desktop launcher
├── package.json             # Project config, test, and desktop scripts
├── scripts/
│   └── build.mjs            # Inlines source modules & verifies bundle syntax
├── src/
│   ├── domain/
│   │   ├── audit.mjs        # Invariant checks & standalone Python script generator
│   │   ├── budgets.mjs      # Rolling allowance & envelope engine
│   │   ├── dateUtils.mjs    # Date arithmetic & currency formatting
│   │   ├── ledger.mjs       # Pure ledger derivation for pool balances
│   │   ├── obligations.mjs  # Unified bills, debts, and counterparty netting
│   │   ├── projection.mjs   # Cap vs Pace future date horizon engine
│   │   ├── recurrence.mjs   # Multi-cadence rule occurrence generator
│   │   └── types.mjs        # Model schemas & default seeds
│   ├── storage/
│   │   ├── backup.mjs       # Full JSON export & restore validator
│   │   ├── migration.mjs    # Non-destructive v1 to v2 migration
│   │   └── sharding.mjs     # Monthly sharding (YYYY-MM) & localStorage fallback
│   └── ui/
│       ├── app.mjs          # AMOLED blocky 5-tab application & modals
│       ├── charts.mjs       # Zero-dependency inline SVG charts & scrubbers
│       └── styles.css       # Catppuccin AMOLED Black theme tokens
└── tests/                   # 25 automated unit & integration test suites
```

---

## License

MIT
