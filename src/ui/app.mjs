import { todayISO, shortDate, formatINR, addDays, getCycleEnd } from '../domain/dateUtils.mjs';
import { calculateCoreNumbers } from '../domain/totals.mjs';
import { calcDailyBudget, calcEnvelope, validateExpenseAdd } from '../domain/budgets.mjs';
import { groupObligationsByPerson, calculateObligationState, advanceBillCycle } from '../domain/obligations.mjs';
import { projectAtDate } from '../domain/projection.mjs';
import { runInvariantsCheck, generatePythonAuditScript } from '../domain/audit.mjs';
import { renderTrajectoryChart, renderSpendBarChart, renderPoolProportions, attachChartInteractions } from './charts.mjs';
import {
  loadConfigFromLocalStorage,
  saveConfigToLocalStorage,
  loadAllLedgerFromLocalStorage,
  saveLedgerToLocalStorage
} from '../storage/sharding.mjs';
import { checkV1Data, migrateV1toV2 } from '../storage/migration.mjs';
import { exportFullBackupJSON, validateAndParseBackup } from '../storage/backup.mjs';

export function initApp(rootElement) {
  // Check and run v1 migration if needed
  const v1 = checkV1Data();
  let config = loadConfigFromLocalStorage();
  let ledgerEntries = loadAllLedgerFromLocalStorage();

  if (v1 && !config.v1Migration) {
    const migration = migrateV1toV2(v1.parsed, v1.raw);
    config = migration.config;
    ledgerEntries = [...ledgerEntries, ...migration.ledgerEntries];
    saveConfigToLocalStorage(config);
    saveLedgerToLocalStorage(ledgerEntries);
  }

  // Application State
  const state = {
    config,
    ledger: ledgerEntries,
    activeTab: config.activeTab || 'overview',
    activeBudgetId: config.activeBudgetId || (config.budgets[0] ? config.budgets[0].id : null),
    horizonDate: getCycleEnd(todayISO(), config.cycleStartDay || 1),
    activeModal: null, // modal name or null
    modalData: null,
    armedDeleteId: null,
    statusMessage: null
  };

  const uid = () => Math.random().toString(36).slice(2, 9);

  function save() {
    saveConfigToLocalStorage(state.config);
    saveLedgerToLocalStorage(state.ledger);
    syncCloud();
  }

  // Claude Artifact DB Sync
  async function syncCloud() {
    try {
      if (typeof window !== 'undefined' && window.claude && window.claude.use) {
        const [d, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (!d || !u) return;
        const id = await u.id();
        if (!id) return;
        const configRef = d.collection('data/users/' + id).doc('config');
        await configRef.set(JSON.parse(JSON.stringify(state.config)));
      }
    } catch (e) {
      console.warn('Claude DB sync deferred:', e);
    }
  }

  function render() {
    const today = todayISO();
    const core = calculateCoreNumbers({
      pools: state.config.pools,
      budgets: state.config.budgets,
      obligations: state.config.obligations,
      ledgerEntries: state.ledger,
      horizonDate: state.horizonDate,
      asOfDate: today
    });

    const projection = projectAtDate({
      targetDate: state.horizonDate,
      asOfDate: today,
      pools: state.config.pools,
      budgets: state.config.budgets,
      obligations: state.config.obligations,
      ledgerEntries: state.ledger,
      expectedIncomes: state.config.expectedIncomes || []
    });

    let html = `
      <header class="app-header">
        <div class="logo-area">
          <span class="logo-tag">AMOLED v2</span>
          <h1 class="app-title">Budget Tracker</h1>
        </div>
        <nav class="tab-nav">
          ${['overview', 'budgets', 'people', 'money', 'analytics', 'add'].map((tab) => `
            <button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
              ${tab}
            </button>
          `).join('')}
        </nav>
      </header>
    `;

    // Render active tab body
    switch (state.activeTab) {
      case 'overview':
        html += renderOverviewTab(core, projection, today);
        break;
      case 'budgets':
        html += renderBudgetsTab(core, today);
        break;
      case 'people':
        html += renderPeopleTab(core);
        break;
      case 'money':
        html += renderMoneyTab(core);
        break;
      case 'analytics':
        html += renderAnalyticsTab(core, projection);
        break;
      case 'add':
        html += renderAddTab();
        break;
      default:
        html += renderOverviewTab(core, projection, today);
    }

    if (state.activeModal) {
      html += renderModal(state.activeModal, core);
    }

    rootElement.innerHTML = html;
    attachListeners();
  }

  // -------------------------------------------------------------
  // TAB 1: OVERVIEW
  // -------------------------------------------------------------
  function renderOverviewTab(core, projection, today) {
    const isUnallocNeg = core.unallocated < 0;
    const isCapNeg = projection.capProjected < 0;

    return `
      <!-- Core KPIs Grid -->
      <section class="hero-grid">
        <div class="kpi-card highlight">
          <div class="kpi-lbl">Total Available</div>
          <div class="kpi-val">${formatINR(core.totalAvailable)}</div>
          <div class="kpi-sub">Across ${core.poolBalances.length} physical pools</div>
        </div>
        <div class="kpi-card ${isUnallocNeg ? 'danger' : 'warn'}">
          <div class="kpi-lbl">Unallocated (Free)</div>
          <div class="kpi-val ${isUnallocNeg ? 'bad' : 'good'}">${formatINR(core.unallocated)}</div>
          <div class="kpi-sub">Committed: ${formatINR(core.committed)} | Shortfall: ${formatINR(core.totalConfirmedShortfall)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-lbl">Net Position</div>
          <div class="kpi-val">${formatINR(core.netPosition)}</div>
          <div class="kpi-sub">Receivables: +${formatINR(core.confirmedReceivablesTotal)} | Debts: −${formatINR(core.confirmedPayablesTotal)}</div>
        </div>
      </section>

      <!-- Arbitrary Future Date Horizon Forecaster -->
      <section class="forecast-box">
        <div class="card-title" style="color:var(--sapphire);">
          <span>Future Date Horizon Forecaster</span>
          <span class="badge blue">${projection.daysToTarget} days out</span>
        </div>
        <p style="font-size:12px;color:var(--mut);margin:0 0 8px;">
          Inspect exact finances at date: <strong>${shortDate(state.horizonDate)}</strong> (${state.horizonDate})
        </p>

        <!-- Quick Date Pickers -->
        <div class="horizon-toggle-bar">
          <button class="horizon-btn" data-set-days="7">+7 Days</button>
          <button class="horizon-btn" data-set-days="14">+14 Days</button>
          <button class="horizon-btn" data-set-cycle="1">End of Cycle</button>
          <button class="horizon-btn" data-set-days="30">+30 Days</button>
          <button class="horizon-btn" data-set-days="60">+60 Days</button>
          <div style="flex:1;min-width:140px;display:flex;align-items:center;gap:4px;">
            <input type="date" id="horizon-date-picker" value="${state.horizonDate}" style="padding:4px 6px;font-size:11px;">
          </div>
        </div>

        <!-- Cap vs Pace Side-by-Side -->
        <div class="grid-2" style="margin-bottom:12px;">
          <div class="card" style="margin:0;border-color:var(--sapphire);background:#090a0f;">
            <div class="kpi-lbl" style="color:var(--acc);">Pace (Expected Velocity)</div>
            <div class="kpi-val good">${formatINR(projection.paceProjected)}</div>
            <div class="kpi-sub">Incorporates scheduled income (+${formatINR(projection.paceIncomeInflow)}) & burn velocity</div>
          </div>
          <div class="card" style="margin:0;border-color:var(--bad);background:#090a0f;">
            <div class="kpi-lbl" style="color:var(--bad);">Cap (Worst-Case Floor)</div>
            <div class="kpi-val ${isCapNeg ? 'bad' : ''}">${formatINR(projection.capProjected)}</div>
            <div class="kpi-sub">Assumes all budgets fully spent & 0 uncollected income</div>
          </div>
        </div>

        <!-- Cash Trajectory SVG Chart -->
        ${renderTrajectoryChart({ trajectory: projection.trajectory, width: 700, height: 180 })}

        <!-- Scheduled Cash Events Breakdown -->
        <div style="margin-top:12px;">
          <div class="card-title" style="margin-bottom:6px;">Scheduled In/Out Events Before ${shortDate(state.horizonDate)}</div>
          ${projection.events.length ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Party / Source</th><th>Amount</th></tr>
                </thead>
                <tbody>
                  ${projection.events.map((e) => `
                    <tr>
                      <td>${shortDate(e.date)}</td>
                      <td><span class="badge ${e.direction === 'in' ? 'acc' : 'bad'}">${e.type}</span></td>
                      <td>${e.name}</td>
                      <td class="${e.direction === 'in' ? 'good' : 'bad'}">${e.direction === 'in' ? '+' : '−'}${formatINR(e.amount)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<div class="sub">No scheduled bills or incomes fall between today and this date.</div>'}
        </div>
      </section>

      <!-- Active Daily Budget Glance -->
      <section class="card">
        <div class="card-title">
          <span>Daily Allowance Highlights</span>
          <button class="sm ghost" data-tab="budgets">View All Budgets &rarr;</button>
        </div>
        ${renderDailyGlance(core, today)}
      </section>
    `;
  }

  function renderDailyGlance(core, today) {
    const daily = core.budgetDetails.find((b) => b.kind === 'daily');
    if (!daily) {
      return `<div class="sub">No daily rolling budget active.</div>`;
    }
    const s = daily.state;
    return `
      <div class="grid-2">
        <div>
          <div class="kpi-lbl">Today's Allowance</div>
          <div class="kpi-val ${s.leftToday < 0 ? 'bad' : 'good'}">${formatINR(s.leftToday)}</div>
          <div class="kpi-sub">Spent today: ${formatINR(s.spentToday)} of ${formatINR(s.currentAllowance)}</div>
        </div>
        <div>
          <div class="kpi-lbl">Days Left</div>
          <div class="kpi-val">${s.daysLeft}</div>
          <div class="kpi-sub">Tomorrow: ${s.tomorrowAllowance !== null ? formatINR(s.tomorrowAllowance) : '—'}</div>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TAB 2: BUDGETS
  // -------------------------------------------------------------
  function renderBudgetsTab(core, today) {
    const dailyBudgets = state.config.budgets.filter((b) => b.kind === 'daily');
    const envelopes = state.config.budgets.filter((b) => b.kind === 'envelope');

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="font-size:14px;margin:0;font-family:var(--font-mono);text-transform:uppercase;">Earmarked Budgets</h2>
        <div style="display:flex;gap:6px;">
          <button class="sm pri" data-action="open-modal" data-modal="new-budget">+ New Budget</button>
          <button class="sm ghost" data-action="open-modal" data-modal="allocate">Allocate / Transfer</button>
        </div>
      </div>

      <!-- Daily Rolling Allowance Budgets -->
      ${dailyBudgets.map((b) => {
        const d = calcDailyBudget(b, state.ledger, today);
        return `
          <div class="card">
            <div class="card-title">
              <span>${b.name} (Rolling Daily)</span>
              <span class="badge acc">${d.daysLeft} days left</span>
            </div>
            <div class="grid-2" style="margin-bottom:10px;">
              <div>
                <div class="kpi-lbl">Today's Left</div>
                <div class="kpi-val ${d.leftToday < 0 ? 'bad' : 'good'}">${formatINR(d.leftToday)}</div>
                <div class="kpi-sub">Allowance: ${formatINR(d.currentAllowance)} | Spent today: ${formatINR(d.spentToday)}</div>
              </div>
              <div>
                <div class="kpi-lbl">Budget Total Left</div>
                <div class="kpi-val ${d.left < 0 ? 'bad' : ''}">${formatINR(d.left)}</div>
                <div class="kpi-sub">Spent ${formatINR(d.spent)} of ${formatINR(d.B)}</div>
              </div>
            </div>

            <!-- Block Progress Bar -->
            <div class="block-bar ${d.left < 0 ? 'over' : ''}">
              <i style="width:${Math.min(100, Math.round((d.spent / d.B) * 100))}%"></i>
            </div>

            <!-- Rolling Day by Day Table -->
            <details style="margin-top:10px;">
              <summary style="font-family:var(--font-mono);font-size:11px;cursor:pointer;color:var(--mut);">Show Day-by-Day Rolling Table</summary>
              <div class="table-wrap" style="margin-top:8px;">
                <table>
                  <thead>
                    <tr><th>Day</th><th>Date</th><th>Allowance</th><th>Spent</th><th>Left</th></tr>
                  </thead>
                  <tbody>
                    ${d.rows.slice(0, d.di + 1).reverse().map((r) => `
                      <tr class="${r.i === d.di ? 'active-row' : ''}">
                        <td>Day ${r.i + 1}</td>
                        <td>${shortDate(r.date)}</td>
                        <td>${formatINR(r.al)}</td>
                        <td>${formatINR(r.sp)}</td>
                        <td class="${r.left < 0 ? 'bad' : ''}">${formatINR(r.left)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        `;
      }).join('')}

      <!-- Envelopes -->
      <div class="card-title" style="margin-top:16px;">Undated Envelopes</div>
      <div class="grid-2">
        ${envelopes.map((env) => {
          const s = calcEnvelope(env, state.ledger);
          return `
            <div class="card">
              <div class="card-title">
                <span>${env.name}</span>
                ${env.hardCap ? '<span class="badge bad">Hard Cap</span>' : ''}
              </div>
              <div class="kpi-val ${s.left < 0 ? 'bad' : ''}">${formatINR(s.left)}</div>
              <div class="kpi-sub">Funded: ${formatINR(s.funded)} | Spent: ${formatINR(s.spent)}</div>
              <div class="block-bar ${s.isOverspent ? 'over' : ''}">
                <i style="width:${s.pctSpent}%"></i>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TAB 3: PEOPLE (OBLIGATIONS, BILLS & DEBTS)
  // -------------------------------------------------------------
  function renderPeopleTab(core) {
    const people = groupObligationsByPerson(state.config.obligations, state.ledger);
    const bills = state.config.obligations.filter((o) => o.role === 'bill');

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="font-size:14px;margin:0;font-family:var(--font-mono);text-transform:uppercase;">People & Recurring Bills</h2>
        <button class="sm pri" data-action="open-modal" data-modal="new-obligation">+ Add Obligation</button>
      </div>

      <!-- Recurring Bills (Rent, Electricity, etc.) -->
      <section class="card">
        <div class="card-title">Recurring Fixed Bills</div>
        ${bills.length ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Bill</th><th>Cadence</th><th>Next Due</th><th>Amount</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                ${bills.map((b) => {
                  const stateOb = calculateObligationState(b, state.ledger);
                  const recurrenceLabel = b.recurrence
                    ? (b.recurrence.interval === 2 ? 'Every 2 months' : `Every ${b.recurrence.interval} ${b.recurrence.unit}`)
                    : 'Monthly';
                  return `
                    <tr>
                      <td><strong>${b.counterparty}</strong></td>
                      <td><span class="badge blue">${recurrenceLabel}</span></td>
                      <td>${b.due ? shortDate(b.due) : '—'}</td>
                      <td>${formatINR(b.principal)}</td>
                      <td><span class="badge ${stateOb.status === 'settled' ? 'acc' : 'warn'}">${stateOb.status}</span></td>
                      <td>
                        <button class="sm ghost" data-action="pay-bill" data-id="${b.id}">Pay & Roll</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="sub">No recurring bills added. Add rent or electricity to track.</div>'}
      </section>

      <!-- Interpersonal Debts & Receivables Grouped by Person -->
      <section class="card">
        <div class="card-title">People (Debts & Receivables Netting)</div>
        ${people.length ? people.map((p) => {
          const isOwedToMe = p.confirmedNet > 0;
          const isIOweThem = p.confirmedNet < 0;
          return `
            <div class="card" style="margin-bottom:8px;background:var(--card-alt);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <strong style="font-size:14px;">${p.person}</strong>
                  <div class="kpi-sub">
                    ${isOwedToMe ? `<span class="good">Owes you ${formatINR(Math.abs(p.confirmedNet))}</span>`
                      : isIOweThem ? `<span class="bad">You owe ${formatINR(Math.abs(p.confirmedNet))}</span>`
                      : '<span class="mut">All debts settled</span>'}
                  </div>
                </div>
                <button class="sm pri" data-action="open-modal" data-modal="repay" data-person="${p.person}">Settle / Repay</button>
              </div>

              <!-- List of items for this person -->
              <div style="margin-top:8px;">
                ${[...p.debts, ...p.receivables].map((item) => `
                  <div class="item-row">
                    <div>
                      <span class="badge ${item.direction === 'receive' ? 'acc' : 'bad'}">
                        ${item.direction === 'receive' ? 'They owe me' : 'I owe them'}
                      </span>
                      <span style="margin-left:6px;font-size:12px;">${item.note || 'Loan / Split'}</span>
                      ${item.status === 'potential' ? `<span class="badge warn">Potential (${item.likelihood}%)</span>` : ''}
                    </div>
                    <div>
                      <span class="mono ${item.direction === 'receive' ? 'good' : 'bad'}">${formatINR(item.outstanding)}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('') : '<div class="sub">No personal debts or loans tracked yet.</div>'}
      </section>
    `;
  }

  // -------------------------------------------------------------
  // TAB 4: MONEY (POOLS, INCOME & INDEPENDENT PYTHON AUDIT)
  // -------------------------------------------------------------
  function renderMoneyTab(core) {
    const activePools = core.poolBalances.filter((p) => !p.isArchived);
    const archivedPools = core.poolBalances.filter((p) => p.isArchived);

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="font-size:14px;margin:0;font-family:var(--font-mono);text-transform:uppercase;">Physical Pools & Reconcile</h2>
        <div style="display:flex;gap:6px;">
          <button class="sm pri" data-action="open-modal" data-modal="new-pool">+ New Pool</button>
          <button class="sm ghost" data-action="open-modal" data-modal="reconcile">Reconcile</button>
        </div>
      </div>

      <!-- Active Pool Balances -->
      <div class="hero-grid" style="grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));">
        ${activePools.map((p) => `
          <div class="kpi-card ${p.balance < 0 ? 'danger' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div class="kpi-lbl">${p.name} (${p.type})</div>
              <span class="badge blue">${p.type}</span>
            </div>
            <div class="kpi-val ${p.balance < 0 ? 'bad' : ''}">${formatINR(p.balance)}</div>
            <div class="kpi-sub">Opening: ${formatINR(p.opening)}</div>
            <div style="display:flex;gap:6px;margin-top:10px;">
              <button class="sm ghost" data-action="open-modal" data-modal="reconcile" data-pool-id="${p.id}" style="flex:1;">Reconcile</button>
              <button class="sm ghost danger" data-action="open-modal" data-modal="manage-pool" data-pool-id="${p.id}" style="flex:1;">Manage</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Archived Pools Section (if any) -->
      ${archivedPools.length ? `
        <section class="card" style="margin-top:12px;background:#0d0f14;border-color:var(--line);">
          <div class="card-title" style="color:var(--mut);">
            <span>Archived Pools (${archivedPools.length})</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Pool</th><th>Type</th><th>Preserved Balance</th><th>Action</th></tr></thead>
              <tbody>
                ${archivedPools.map((ap) => `
                  <tr>
                    <td><strong>${ap.name}</strong></td>
                    <td><span class="badge">${ap.type}</span></td>
                    <td>${formatINR(ap.balance)}</td>
                    <td><button class="sm pri" data-action="unarchive-pool" data-pool-id="${ap.id}">Restore / Unarchive</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      ` : ''}

      <!-- Data Storage, Backup & Restore Section -->
      <section class="card" style="border:2px solid var(--acc);margin-top:16px;">
        <div class="card-title" style="color:var(--acc);">
          <span>Data Storage, Backup & Migration</span>
          <span class="badge acc">Local & Private</span>
        </div>
        <p style="font-size:12px;color:var(--mut);margin:0 0 10px;">
          All financial data is stored securely in your device's browser sandbox (monthly sharded docs).
          Export a complete JSON backup to save your data or transfer it to another phone or computer.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="pri" data-action="export-json-backup">Export Full Backup (JSON)</button>
          <button class="ghost" data-action="trigger-restore-json">Restore from Backup (JSON)</button>
          <input type="file" id="restore-json-input" accept=".json" style="display:none;">
        </div>
      </section>

      <!-- Mobile App & Desktop App Guide -->
      <section class="card" style="margin-top:12px;">
        <details>
          <summary style="font-family:var(--font-mono);font-size:12px;font-weight:700;cursor:pointer;color:var(--sapphire);text-transform:uppercase;">
            How to use on Mobile & Desktop (PWA / Electron)
          </summary>
          <div style="margin-top:10px;font-size:12px;line-height:1.6;color:var(--fg);">
            <p><strong>Mobile App (iOS Safari):</strong> Tap the <em>Share</em> button (square with up arrow) &rarr; select <strong>"Add to Home Screen"</strong>. Launches full-screen in pure AMOLED black with zero browser chrome.</p>
            <p><strong>Mobile App (Android Chrome / Brave):</strong> Tap the menu (<strong>⋮</strong>) &rarr; select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>. Works 100% offline.</p>
            <p><strong>Native Desktop App:</strong> Run <code>npm run desktop</code> from this folder to launch the dedicated native Electron desktop window.</p>
          </div>
        </details>
      </section>

      <!-- Independent Verification & Python Script Export -->
      <section class="card" style="border:2px solid var(--sapphire);margin-top:16px;">
        <div class="card-title" style="color:var(--sapphire);">
          <span>Independent Calculation Audit & Verification</span>
          <span class="badge blue">Python 3 CLI</span>
        </div>
        <p style="font-size:12px;color:var(--mut);margin:0 0 10px;">
          Verify every single pool balance, allowance formula, shortfall, and projection independently.
          Download a zero-dependency Python audit script embedding your active ledger data, or run the in-browser invariant health test.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="pri" data-action="export-python-audit">
            Export Python Audit Script (verify_ledger.py)
          </button>
          <button class="ghost" data-action="open-modal" data-modal="integrity-check">
            Run In-Browser Invariants Check
          </button>
        </div>
      </section>

      <!-- Expected Income Log -->
      <section class="card" style="margin-top:12px;">
        <div class="card-title">
          <span>Scheduled & Expected Incomes</span>
          <button class="sm ghost" data-action="open-modal" data-modal="new-income">+ Add Income</button>
        </div>
        ${state.config.expectedIncomes && state.config.expectedIncomes.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Source</th><th>Amount</th><th>Cadence / Date</th><th>Action</th></tr></thead>
              <tbody>
                ${state.config.expectedIncomes.map((inc, i) => `
                  <tr>
                    <td><strong>${inc.source}</strong></td>
                    <td class="good">+${formatINR(inc.amount)}</td>
                    <td>${inc.recurrence ? `Every ${inc.recurrence.interval} ${inc.recurrence.unit}` : shortDate(inc.date)}</td>
                    <td><button class="sm danger" data-action="del-expected-income" data-idx="${i}">Delete</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="sub">No expected recurring incomes added yet.</div>'}
      </section>
    `;
  }

  // -------------------------------------------------------------
  // TAB 5: ANALYTICS & CHARTS
  // -------------------------------------------------------------
  function renderAnalyticsTab(core, projection) {
    return `
      <h2 style="font-size:14px;margin:0 0 12px;font-family:var(--font-mono);text-transform:uppercase;">Visual Analytics & Charts</h2>

      <!-- Spend vs Funded Chart -->
      <div class="card">
        <div class="card-title">Spend vs Funded Distribution</div>
        ${renderSpendBarChart({ budgetDetails: core.budgetDetails, width: 700 })}
      </div>

      <!-- Physical Pools Allocation Gauge -->
      <div class="card">
        <div class="card-title">Physical Pool Allocation</div>
        ${renderPoolProportions({ poolBalances: core.poolBalances, width: 700, height: 32 })}
      </div>

      <!-- Recent Ledger Transactions -->
      <div class="card">
        <div class="card-title">
          <span>Ledger Journal (Append-Only)</span>
          <span class="mono" style="font-size:11px;color:var(--mut);">${state.ledger.length} total entries</span>
        </div>
        <div class="table-wrap" style="max-height:300px;overflow-y:auto;">
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Details</th><th>Amount</th><th>Del</th></tr>
            </thead>
            <tbody>
              ${state.ledger.slice(-30).reverse().map((e) => `
                <tr>
                  <td>${shortDate(e.date)}</td>
                  <td><span class="badge">${e.type}</span></td>
                  <td>${e.note || e.source || '—'}</td>
                  <td class="mono ${e.type === 'income' ? 'good' : 'bad'}">${formatINR(e.amount)}</td>
                  <td><button class="sm danger" data-action="del-ledger-entry" data-id="${e.id}">&times;</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TAB 6: QUICK ADD ENTRY
  // -------------------------------------------------------------
  function renderAddTab() {
    const pools = state.config.pools;
    const budgets = state.config.budgets;

    return `
      <div class="card" style="max-width:560px;margin:0 auto;">
        <h2 style="font-size:14px;margin:0 0 12px;font-family:var(--font-mono);text-transform:uppercase;">Quick Add Transaction</h2>
        
        <form id="quick-add-form">
          <div class="form-row">
            <div>
              <label>Transaction Type</label>
              <select id="qa-type">
                <option value="expense">Expense (Spend)</option>
                <option value="income">Income (Deposit)</option>
                <option value="transfer">Transfer (Pool to Pool)</option>
                <option value="loan_out">Loan Given (Someone owes me)</option>
                <option value="loan_in">Loan Received (I owe someone)</option>
              </select>
            </div>
            <div>
              <label>Amount (₹)</label>
              <input id="qa-amt" type="number" step="any" min="1" placeholder="Amount" required autofocus>
            </div>
          </div>

          <div class="form-row" id="qa-budget-row">
            <div>
              <label>Charge to Budget / Envelope</label>
              <select id="qa-budget">
                ${budgets.map((b) => `<option value="${b.id}">${b.name} (${b.kind})</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div>
              <label>Physical Pool</label>
              <select id="qa-pool">
                ${pools.map((p) => `<option value="${p.id}">${p.name} (${formatINR(p.balance || 0)})</option>`).join('')}
              </select>
            </div>
            <div id="qa-to-pool-col" style="display:none;">
              <label>Destination Pool</label>
              <select id="qa-to-pool">
                ${pools.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row" id="qa-counterparty-row" style="display:none;">
            <div>
              <label>Person / Counterparty</label>
              <input id="qa-person" placeholder="e.g. Alice, Bob">
            </div>
          </div>

          <div class="form-row">
            <div>
              <label>Date</label>
              <input id="qa-date" type="date" value="${todayISO()}">
            </div>
            <div>
              <label>Note / Description</label>
              <input id="qa-note" placeholder="Dinner, Groceries, etc.">
            </div>
          </div>

          <div id="qa-err" style="color:var(--bad);font-family:var(--font-mono);font-size:12px;margin-bottom:8px;"></div>
          <button class="pri" type="submit" style="width:100%;">Record Entry</button>
        </form>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // MODALS
  // -------------------------------------------------------------
  function renderModal(modalName, core) {
    let content = '';

    if (modalName === 'integrity-check') {
      const check = runInvariantsCheck(state.config, state.ledger);
      content = `
        <div class="modal-header">
          <h3 class="modal-title">System Invariants & Mathematical Health</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <p style="font-size:12px;color:var(--mut);">All checks evaluated at ${shortDate(todayISO())}:</p>
        <div style="margin-bottom:14px;">
          ${check.checks.map((c) => `
            <div class="item-row">
              <div>
                <strong style="font-size:12px;">${c.name}</strong>
                <div class="kpi-sub">${c.detail}</div>
              </div>
              <span class="badge ${c.status === 'pass' ? 'acc' : c.status === 'warn' ? 'warn' : 'bad'}">${c.status}</span>
            </div>
          `).join('')}
        </div>
        <button class="ghost" data-action="close-modal" style="width:100%;">Close</button>
      `;
    } else if (modalName === 'new-budget') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Create Budget or Envelope</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-new-budget">
          <div class="form-row">
            <div>
              <label>Budget Name</label>
              <input id="mb-name" placeholder="e.g. Dining, Travel" required>
            </div>
            <div>
              <label>Kind</label>
              <select id="mb-kind">
                <option value="envelope">Envelope (Undated)</option>
                <option value="daily">Daily (Rolling Allowance)</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Allocated Amount (₹)</label>
              <input id="mb-amt" type="number" min="0" value="3000" required>
            </div>
            <div id="mb-days-col" style="display:none;">
              <label>Cycle Days</label>
              <input id="mb-days" type="number" min="1" value="30">
            </div>
          </div>
          <div class="form-row">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="mb-hardcap" style="width:auto;"> Hard Cap (Block spends when exhausted)
            </label>
          </div>
          <button class="pri" type="submit" style="width:100%;">Create Budget</button>
        </form>
      `;
    } else if (modalName === 'new-obligation') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Add Obligation / Bill</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-new-obligation">
          <div class="form-row">
            <div>
              <label>Role</label>
              <select id="mo-role">
                <option value="bill">Recurring Fixed Bill (Rent, Electricity)</option>
                <option value="debt">Debt (I owe a person)</option>
                <option value="receivable">Receivable (Person owes me)</option>
              </select>
            </div>
            <div>
              <label>Counterparty / Provider</label>
              <input id="mo-party" placeholder="e.g. Landlord, BESCOM, Bob" required>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Amount (₹)</label>
              <input id="mo-amt" type="number" min="1" required>
            </div>
            <div>
              <label>Next Due Date</label>
              <input id="mo-due" type="date" value="${addDays(todayISO(), 14)}">
            </div>
          </div>
          <div class="form-row" id="mo-recurrence-row">
            <div>
              <label>Cadence</label>
              <select id="mo-cadence">
                <option value="1-months">Monthly (Every 1 month)</option>
                <option value="2-months">Bimonthly (Every 2 months, e.g. electricity)</option>
                <option value="12-months">Annually (Every 1 year)</option>
                <option value="none">One-off (No recurrence)</option>
              </select>
            </div>
          </div>
          <button class="pri" type="submit" style="width:100%;">Save Obligation</button>
        </form>
      `;
    } else if (modalName === 'allocate') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Allocate / Transfer Funds</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-allocate">
          <div class="form-row">
            <div>
              <label>Source of Funds</label>
              <select id="mal-from">
                <option value="unallocated">Unallocated Pool Money (₹${Math.max(0, core.unallocated).toFixed(2)} available)</option>
                ${state.config.budgets.map((b) => `<option value="${b.id}">Budget: ${b.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Destination Budget / Envelope</label>
              <select id="mal-to">
                ${state.config.budgets.map((b) => `<option value="${b.id}">${b.name} (${b.kind})</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Amount to Allocate (₹)</label>
              <input id="mal-amt" type="number" min="1" step="any" placeholder="Amount" required autofocus>
            </div>
          </div>
          <div id="mal-err" style="color:var(--bad);font-family:var(--font-mono);font-size:12px;margin-bottom:8px;"></div>
          <button class="pri" type="submit" style="width:100%;">Transfer Allocation</button>
        </form>
      `;
    } else if (modalName === 'repay') {
      const person = (state.modalData?.person || '').trim();
      const personObs = state.config.obligations.filter((o) =>
        (o.counterparty || '').trim() === person &&
        o.status !== 'settled' && o.status !== 'forgiven' && o.status !== 'cancelled'
      );
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Settle / Repay: ${person || 'Person'}</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        ${personObs.length ? `
          <form id="modal-form-repay">
            <div class="form-row">
              <div>
                <label>Select Item to Settle</label>
                <select id="mrp-ob">
                  ${personObs.map((o) => {
                    const s = calculateObligationState(o, state.ledger);
                    return `<option value="${o.id}">${o.direction === 'receive' ? 'They owe me' : 'I owe them'}: ${formatINR(s.outstanding)} (${o.note || o.role})</option>`;
                  }).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div>
                <label>Pool Used</label>
                <select id="mrp-pool">
                  ${state.config.pools.map((p) => `<option value="${p.id}">${p.name} (${formatINR(p.balance || 0)})</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Amount (₹)</label>
                <input id="mrp-amt" type="number" min="1" step="any" placeholder="Repayment amount" required autofocus>
              </div>
            </div>
            <div class="form-row" style="display:flex;gap:8px;">
              <button class="pri" type="submit" style="flex:2;">Record Repayment</button>
              <button type="button" class="danger sm" id="mrp-forgive-btn" style="flex:1;">Forgive / Close</button>
            </div>
          </form>
        ` : `
          <p style="color:var(--mut);font-size:12px;margin:10px 0;">No active outstanding debts or receivables for ${person || 'this person'}.</p>
          <button class="ghost" data-action="close-modal" style="width:100%;">Close</button>
        `}
      `;
    } else if (modalName === 'new-pool') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Create Physical Pool</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-new-pool">
          <div class="form-row">
            <div>
              <label>Pool Name</label>
              <input id="mnp-name" placeholder="e.g. HDFC Bank, Physical Cash" required autofocus>
            </div>
            <div>
              <label>Type</label>
              <select id="mnp-type">
                <option value="bank">Bank Account</option>
                <option value="cash">Cash in Hand</option>
                <option value="upi">UPI / Digital Wallet</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Opening Balance (₹)</label>
              <input id="mnp-opening" type="number" step="any" value="0" required>
            </div>
          </div>
          <button class="pri" type="submit" style="width:100%;">Create Pool</button>
        </form>
      `;
    } else if (modalName === 'new-income') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Schedule Expected / Recurring Income</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-new-income">
          <div class="form-row">
            <div>
              <label>Source / Label</label>
              <input id="mni-source" placeholder="e.g. Salary, Consulting, Dividend" required autofocus>
            </div>
            <div>
              <label>Amount (₹)</label>
              <input id="mni-amt" type="number" min="1" step="any" placeholder="Amount" required>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Start / Expected Date</label>
              <input id="mni-date" type="date" value="${todayISO()}">
            </div>
            <div>
              <label>Cadence</label>
              <select id="mni-cadence">
                <option value="1-months">Monthly (Every 1 month)</option>
                <option value="2-weeks">Biweekly (Every 2 weeks)</option>
                <option value="none">One-off Expected Date</option>
              </select>
            </div>
          </div>
          <button class="pri" type="submit" style="width:100%;">Schedule Income</button>
        </form>
      `;
    } else if (modalName === 'manage-pool') {
      const poolId = state.modalData?.poolId;
      const pool = state.config.pools.find((p) => p.id === poolId);
      const otherPools = state.config.pools.filter((p) => p.id !== poolId && !p.isArchived);
      const hasTransactions = state.ledger.some((e) => e.poolId === poolId || e.toPoolId === poolId);
      const poolBalance = (core.poolBalances.find((p) => p.id === poolId)?.balance) || 0;

      content = `
        <div class="modal-header">
          <h3 class="modal-title">Manage Pool: ${pool ? pool.name : 'Pool'}</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        ${pool ? `
          <div style="margin-bottom:12px;font-size:12px;color:var(--mut);">
            Current calculated balance: <strong class="${poolBalance < 0 ? 'bad' : 'good'}">${formatINR(poolBalance)}</strong>
          </div>
          ${poolBalance > 0 && otherPools.length ? `
            <form id="modal-form-transfer-archive">
              <p style="font-size:12px;color:var(--peach);margin-bottom:8px;">
                This pool contains funds. Transfer balance to another pool before archiving:
              </p>
              <div class="form-row">
                <div>
                  <label>Transfer Remaining to</label>
                  <select id="mta-to-pool">
                    ${otherPools.map((op) => `<option value="${op.id}">${op.name} (${formatINR(op.balance || 0)})</option>`).join('')}
                  </select>
                </div>
              </div>
              <div style="display:flex;gap:8px;margin-top:10px;">
                <button class="pri" type="submit" style="flex:1;">Transfer & Archive</button>
                <button type="button" class="danger sm" id="mta-direct-archive" style="flex:1;">Archive Without Transfer</button>
              </div>
            </form>
          ` : `
            <div>
              <p style="font-size:12px;color:var(--mut);margin-bottom:12px;">
                ${hasTransactions
                  ? 'This pool has transaction history. Archiving hides it from active dashboards and excludes it from Total Available, while preserving your historical accounting.'
                  : 'This pool is empty and has no transaction history. You can safely delete it permanently.'}
              </p>
              <div style="display:flex;gap:8px;">
                <button class="pri" id="btn-confirm-archive" style="flex:1;">Archive Pool</button>
                ${!hasTransactions ? `
                  <button class="danger sm" id="btn-confirm-delete" style="flex:1;">Delete Permanently</button>
                ` : ''}
              </div>
            </div>
          `}
        ` : `
          <div class="sub">Pool not found.</div>
          <button class="ghost" data-action="close-modal">Close</button>
        `}
      `;
    } else if (modalName === 'reconcile') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Reconcile Pool to Reality</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-reconcile">
          <div class="form-row">
            <div>
              <label>Select Pool</label>
              <select id="mr-pool">
                ${state.config.pools.map((p) => `<option value="${p.id}">${p.name} (Calculated: ${formatINR(p.balance || 0)})</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Real Physical Balance (₹)</label>
              <input id="mr-real" type="number" step="any" placeholder="Actual money present" required>
            </div>
          </div>
          <button class="pri" type="submit" style="width:100%;">Apply Balancing Adjustment</button>
        </form>
      `;
    }

    return `
      <div class="modal-overlay" data-action="close-modal-overlay">
        <div class="modal-content">
          ${content}
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // EVENT LISTENERS
  // -------------------------------------------------------------
  function attachListeners() {
    attachChartInteractions(rootElement);

    // Tab switching
    rootElement.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.getAttribute('data-tab');
        state.config.activeTab = state.activeTab;
        save();
        render();
      });
    });

    // Date Horizon Controls
    rootElement.querySelectorAll('[data-set-days]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = Number(btn.getAttribute('data-set-days'));
        state.horizonDate = addDays(todayISO(), days);
        render();
      });
    });

    rootElement.querySelectorAll('[data-set-cycle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.horizonDate = getCycleEnd(todayISO(), state.config.cycleStartDay || 1);
        render();
      });
    });

    const datePicker = rootElement.querySelector('#horizon-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        if (e.target.value) {
          state.horizonDate = e.target.value;
          render();
        }
      });
    }

    // Modal Triggers
    rootElement.querySelectorAll('[data-action="open-modal"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeModal = btn.getAttribute('data-modal');
        state.modalData = {
          person: btn.getAttribute('data-person'),
          poolId: btn.getAttribute('data-pool-id')
        };
        render();
      });
    });

    rootElement.querySelectorAll('[data-action="close-modal"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeModal = null;
        state.modalData = null;
        render();
      });
    });

    const overlay = rootElement.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          state.activeModal = null;
          state.modalData = null;
          render();
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.onkeydown = (e) => {
        if (e.key === 'Escape' && state.activeModal) {
          state.activeModal = null;
          state.modalData = null;
          render();
        }
      };
    }

    // Export Python Audit Script
    const exportPyBtn = rootElement.querySelector('[data-action="export-python-audit"]');
    if (exportPyBtn) {
      exportPyBtn.addEventListener('click', () => {
        const pyScript = generatePythonAuditScript(state.config, state.ledger, state.horizonDate);
        const blob = new Blob([pyScript], { type: 'text/x-python' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'verify_ledger.py';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    // Pay Bill & Roll
    rootElement.querySelectorAll('[data-action="pay-bill"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const bill = state.config.obligations.find((o) => o.id === id);
        if (bill) {
          // Record payment expense
          state.ledger.push({
            id: uid(),
            date: todayISO(),
            type: 'expense',
            amount: bill.principal,
            poolId: state.config.pools[0]?.id || 'pool-bank',
            obligationId: bill.id,
            note: `Bill payment: ${bill.counterparty}`
          });
          // Roll next due date
          const updated = advanceBillCycle(bill, todayISO());
          Object.assign(bill, updated);
          save();
          render();
        }
      });
    });

    // Delete Ledger Entry
    rootElement.querySelectorAll('[data-action="del-ledger-entry"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        state.ledger = state.ledger.filter((e) => e.id !== id);
        save();
        render();
      });
    });

    // Quick Add Form
    const qaForm = rootElement.querySelector('#quick-add-form');
    if (qaForm) {
      const qaType = rootElement.querySelector('#qa-type');
      const budgetRow = rootElement.querySelector('#qa-budget-row');
      const toPoolCol = rootElement.querySelector('#qa-to-pool-col');
      const counterpartyRow = rootElement.querySelector('#qa-counterparty-row');

      qaType.addEventListener('change', () => {
        const t = qaType.value;
        budgetRow.style.display = t === 'expense' ? 'flex' : 'none';
        toPoolCol.style.display = t === 'transfer' ? 'block' : 'none';
        counterpartyRow.style.display = (t === 'loan_in' || t === 'loan_out') ? 'flex' : 'none';
      });

      qaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const type = qaType.value;
        const amt = Number(rootElement.querySelector('#qa-amt').value);
        const poolId = rootElement.querySelector('#qa-pool').value;
        const note = rootElement.querySelector('#qa-note').value.trim();
        const date = rootElement.querySelector('#qa-date').value || todayISO();
        const errDiv = rootElement.querySelector('#qa-err');

        if (!(amt > 0)) {
          errDiv.textContent = 'Please enter a valid amount > 0';
          return;
        }

        if (type === 'expense') {
          const budgetId = rootElement.querySelector('#qa-budget').value;
          const budget = state.config.budgets.find((b) => b.id === budgetId);
          if (budget) {
            const check = validateExpenseAdd(budget, amt, state.ledger);
            if (!check.allowed) {
              errDiv.textContent = check.reason;
              return;
            }
          }
          state.ledger.push({ id: uid(), date, type: 'expense', amount: amt, poolId, budgetId, note });
        } else if (type === 'income') {
          state.ledger.push({ id: uid(), date, type: 'income', amount: amt, poolId, source: note || 'Income', note });
        } else if (type === 'transfer') {
          const toPoolId = rootElement.querySelector('#qa-to-pool').value;
          if (toPoolId === poolId) {
            errDiv.textContent = 'Source and destination pools must be different.';
            return;
          }
          state.ledger.push({ id: uid(), date, type: 'transfer', amount: amt, poolId, toPoolId, note });
        } else if (type === 'loan_out') {
          const person = rootElement.querySelector('#qa-person').value.trim() || 'Friend';
          const obId = uid();
          state.config.obligations.push({
            id: obId,
            role: 'receivable',
            counterparty: person,
            direction: 'receive',
            principal: amt,
            outstanding: amt,
            created: date,
            status: 'confirmed',
            likelihood: 100,
            note
          });
          state.ledger.push({ id: uid(), date, type: 'loan_out', amount: amt, poolId, obligationId: obId, note });
        } else if (type === 'loan_in') {
          const person = rootElement.querySelector('#qa-person').value.trim() || 'Friend';
          const obId = uid();
          state.config.obligations.push({
            id: obId,
            role: 'debt',
            counterparty: person,
            direction: 'pay',
            principal: amt,
            outstanding: amt,
            created: date,
            status: 'confirmed',
            likelihood: 100,
            note
          });
          state.ledger.push({ id: uid(), date, type: 'loan_in', amount: amt, poolId, obligationId: obId, note });
        }

        save();
        state.activeTab = 'overview';
        render();
      });
    }

    // Modal Submissions
    const mBudgetForm = rootElement.querySelector('#modal-form-new-budget');
    if (mBudgetForm) {
      const kindSelect = rootElement.querySelector('#mb-kind');
      const daysCol = rootElement.querySelector('#mb-days-col');
      kindSelect.addEventListener('change', () => {
        daysCol.style.display = kindSelect.value === 'daily' ? 'block' : 'none';
      });

      mBudgetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = rootElement.querySelector('#mb-name').value.trim() || 'Budget';
        const kind = kindSelect.value;
        const amt = Number(rootElement.querySelector('#mb-amt').value) || 0;
        const hardCap = rootElement.querySelector('#mb-hardcap').checked;
        const days = Number(rootElement.querySelector('#mb-days').value) || 30;

        state.config.budgets.push({
          id: uid(),
          name,
          kind,
          amount: amt,
          days: kind === 'daily' ? days : undefined,
          start: todayISO(),
          hardCap,
          funding: [{ poolId: state.config.pools[0]?.id || 'pool-bank', amount: amt }]
        });

        state.activeModal = null;
        save();
        render();
      });
    }

    const mAllocateForm = rootElement.querySelector('#modal-form-allocate');
    if (mAllocateForm) {
      mAllocateForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fromVal = rootElement.querySelector('#mal-from').value;
        const toBudgetId = rootElement.querySelector('#mal-to').value;
        const amt = Number(rootElement.querySelector('#mal-amt').value);
        const errDiv = rootElement.querySelector('#mal-err');

        if (!(amt > 0)) {
          errDiv.textContent = 'Please enter an amount > 0';
          return;
        }

        if (fromVal === toBudgetId) {
          errDiv.textContent = 'Source and destination cannot be the same.';
          return;
        }

        const fromBudgetId = fromVal === 'unallocated' ? null : fromVal;
        const fromName = fromBudgetId
          ? (state.config.budgets.find((b) => b.id === fromBudgetId)?.name || 'Budget')
          : 'Unallocated';
        const toName = state.config.budgets.find((b) => b.id === toBudgetId)?.name || 'Budget';

        state.ledger.push({
          id: uid(),
          date: todayISO(),
          type: 'allocation',
          fromBudgetId,
          toBudgetId,
          amount: amt,
          note: `Allocation: ${fromName} -> ${toName}`
        });

        state.activeModal = null;
        save();
        render();
      });
    }

    const mRepayForm = rootElement.querySelector('#modal-form-repay');
    if (mRepayForm) {
      mRepayForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const obId = rootElement.querySelector('#mrp-ob').value;
        const poolId = rootElement.querySelector('#mrp-pool').value;
        const amt = Number(rootElement.querySelector('#mrp-amt').value);
        const ob = state.config.obligations.find((o) => o.id === obId);
        if (ob && amt > 0) {
          const dir = ob.direction === 'receive' ? 'in' : 'out';
          state.ledger.push({
            id: uid(),
            date: todayISO(),
            type: 'repayment',
            obligationId: ob.id,
            poolId,
            direction: dir,
            amount: amt,
            note: `Repayment from/to ${ob.counterparty}`
          });
          state.activeModal = null;
          save();
          render();
        }
      });

      const forgiveBtn = rootElement.querySelector('#mrp-forgive-btn');
      if (forgiveBtn) {
        forgiveBtn.addEventListener('click', () => {
          const obId = rootElement.querySelector('#mrp-ob').value;
          const ob = state.config.obligations.find((o) => o.id === obId);
          if (ob) {
            ob.status = 'forgiven';
            ob.outstanding = 0;
            state.activeModal = null;
            save();
            render();
          }
        });
      }
    }

    const mNewPoolForm = rootElement.querySelector('#modal-form-new-pool');
    if (mNewPoolForm) {
      mNewPoolForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = rootElement.querySelector('#mnp-name').value.trim() || 'Pool';
        const type = rootElement.querySelector('#mnp-type').value;
        const opening = Number(rootElement.querySelector('#mnp-opening').value) || 0;
        state.config.pools.push({
          id: uid(),
          name,
          type,
          opening,
          balance: opening,
          isArchived: false
        });
        state.activeModal = null;
        save();
        render();
      });
    }

    const mNewIncomeForm = rootElement.querySelector('#modal-form-new-income');
    if (mNewIncomeForm) {
      mNewIncomeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const source = rootElement.querySelector('#mni-source').value.trim() || 'Income';
        const amount = Number(rootElement.querySelector('#mni-amt').value) || 0;
        const date = rootElement.querySelector('#mni-date').value || todayISO();
        const cadence = rootElement.querySelector('#mni-cadence').value;

        let recurrence = null;
        if (cadence !== 'none') {
          const [intStr, unit] = cadence.split('-');
          recurrence = {
            interval: Number(intStr) || 1,
            unit,
            anchorDate: date
          };
        }

        if (!Array.isArray(state.config.expectedIncomes)) {
          state.config.expectedIncomes = [];
        }

        state.config.expectedIncomes.push({
          id: uid(),
          source,
          amount,
          date,
          recurrence,
          likelihood: 100
        });

        state.activeModal = null;
        save();
        render();
      });
    }

    rootElement.querySelectorAll('[data-action="del-expected-income"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        if (Array.isArray(state.config.expectedIncomes)) {
          state.config.expectedIncomes.splice(idx, 1);
          save();
          render();
        }
      });
    });

    // Unarchive Pool
    rootElement.querySelectorAll('[data-action="unarchive-pool"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-pool-id');
        const p = state.config.pools.find((x) => x.id === pid);
        if (p) {
          p.isArchived = false;
          save();
          render();
        }
      });
    });

    // Transfer & Archive Pool
    const mtaForm = rootElement.querySelector('#modal-form-transfer-archive');
    if (mtaForm) {
      mtaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const poolId = state.modalData?.poolId;
        const toPoolId = rootElement.querySelector('#mta-to-pool').value;
        const pool = state.config.pools.find((p) => p.id === poolId);
        const coreNumbers = calculateCoreNumbers({
          pools: state.config.pools,
          budgets: state.config.budgets,
          obligations: state.config.obligations,
          ledgerEntries: state.ledger
        });
        const poolBalance = (coreNumbers.poolBalances.find((p) => p.id === poolId)?.balance) || 0;

        if (pool && toPoolId && poolBalance > 0) {
          const toPool = state.config.pools.find((p) => p.id === toPoolId);
          state.ledger.push({
            id: uid(),
            date: todayISO(),
            type: 'transfer',
            poolId,
            toPoolId,
            amount: poolBalance,
            note: `Closing transfer: ${pool.name} -> ${toPool?.name || 'Pool'}`
          });
        }
        if (pool) pool.isArchived = true;
        state.activeModal = null;
        save();
        render();
      });

      const directArchiveBtn = rootElement.querySelector('#mta-direct-archive');
      if (directArchiveBtn) {
        directArchiveBtn.addEventListener('click', () => {
          const poolId = state.modalData?.poolId;
          const pool = state.config.pools.find((p) => p.id === poolId);
          if (pool) pool.isArchived = true;
          state.activeModal = null;
          save();
          render();
        });
      }
    }

    const archiveBtn = rootElement.querySelector('#btn-confirm-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', () => {
        const poolId = state.modalData?.poolId;
        const pool = state.config.pools.find((p) => p.id === poolId);
        if (pool) pool.isArchived = true;
        state.activeModal = null;
        save();
        render();
      });
    }

    const deleteBtn = rootElement.querySelector('#btn-confirm-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const poolId = state.modalData?.poolId;
        state.config.pools = state.config.pools.filter((p) => p.id !== poolId);
        state.activeModal = null;
        save();
        render();
      });
    }

    // Export Full JSON Backup
    const expJsonBtn = rootElement.querySelector('[data-action="export-json-backup"]');
    if (expJsonBtn) {
      expJsonBtn.addEventListener('click', () => {
        const jsonStr = exportFullBackupJSON(state.config, state.ledger);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `budget-backup-${todayISO()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    // Restore Backup from JSON
    const trigRestoreBtn = rootElement.querySelector('[data-action="trigger-restore-json"]');
    const restoreInput = rootElement.querySelector('#restore-json-input');
    if (trigRestoreBtn && restoreInput) {
      trigRestoreBtn.addEventListener('click', () => {
        restoreInput.click();
      });
      restoreInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const restored = validateAndParseBackup(event.target.result);
            state.config = restored.config;
            state.ledger = restored.ledger;
            save();
            alert('Backup successfully restored!');
            render();
          } catch (err) {
            alert('Failed to restore backup: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    }
  }

  render();
}
