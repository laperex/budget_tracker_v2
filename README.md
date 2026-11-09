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

### 1. Web App (GitHub Pages — Recommended for Mobile & Desktop)
Deploy to GitHub Pages to get an HTTPS Progressive Web App (PWA) with 100% offline support:
- Go to repository **Settings** &rarr; **Pages**.
- Under **Build and deployment** &rarr; **Source**, select **GitHub Actions** (or select **Deploy from a branch** &rarr; `main` / `root`).
- Open your site: `https://<username>.github.io/budget_tracker_v2/`.
- **Privacy Guarantee**: GitHub Pages only serves the static code. All your transactions and budgets are saved exclusively on your phone/computer in local storage; **nothing is ever transmitted to GitHub or any server**.

### 2. Run in Browser (Local HTML File)
Double-click or open [`Budget Tracker v2.html`](./Budget%20Tracker%20v2.html) (or [`index.html`](./index.html)) directly in any desktop browser.

### 3. Run as Native Desktop App (Electron)
Launch a dedicated, frameless native AMOLED desktop window with local window persistence:
```bash
npm install # if not already installed
npm run desktop
```

### 4. Run Automated Tests
Execute the 25-test Node.js test suite and cross-language Python mathematical audit:
```bash
npm test
```

### 5. Build from Source
Re-bundle the modular source files into standalone HTML, manifest, icon, and offline service worker:
```bash
npm run build
```

---

## How to Install as a Mobile App (PWA)

> [!IMPORTANT]
> **Why opening `.html` directly gives an error in Chrome mobile**:
> Google Chrome and modern mobile browsers require a **Secure Origin (HTTPS)** or `localhost` to install Progressive Web Apps and register Service Workers. Android Chrome will block or fail "Add to Home screen" if opened from a raw `file:///` path.
> 
> **The Solution**: Open your **GitHub Pages URL** (`https://<username>.github.io/budget_tracker_v2/`) in Chrome mobile, which provides genuine HTTPS and unlocks instant installation.

### Android (Chrome, Brave, Samsung Internet)
1. Open your GitHub Pages link in Chrome on your phone:
   `https://<username>.github.io/budget_tracker_v2/`
2. Chrome will automatically display an **"Add Budget Tracker to Home screen"** banner, or tap the browser menu (**⋮**) in the top-right corner.
3. Select **"Install app"** (or **"Add to Home screen"**).
4. Tap **Install**.
5. The **Budget Tracker** icon (₹) will now appear directly in your Android app drawer and home screen.
6. **Offline Capability**: Thanks to the built-in Service Worker (`sw.js`), after the initial load, the app works **100% offline** — you can record expenses in airplane mode with no internet connection.

### iPhone / iPad (Safari)
1. Open your GitHub Pages link in **Safari**:
   `https://<username>.github.io/budget_tracker_v2/`
2. Tap the **Share** button (the square with an arrow pointing upwards).
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **Add** in the top-right corner.
5. The app launches full-screen without Safari browser bars in pitch-black AMOLED mode.

### Alternative (No Cloud / Local Only via Termux)
If you prefer not to use GitHub Pages:
1. On Android, open **Termux** and run:
   ```bash
   npx serve dist -p 8080
   # or: python3 -m http.server 8080
   ```
2. Open `http://localhost:8080` in Chrome mobile.
3. Chrome treats `localhost` as a secure origin, allowing you to tap **"Install app"** to home screen.

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
