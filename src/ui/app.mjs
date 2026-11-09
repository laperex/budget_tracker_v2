import { todayISO, shortDate, formatINR, addDays, getCycleEnd } from '../domain/dateUtils.mjs';
import {
  createRecord,
  editRecord,
  deleteRecord,
  clearAllRecords,
  createInitialSeedRecords,
  ALL_RECORD_TYPES,
  TRANSACTION_TYPES,
  ENTITY_TYPES
} from '../domain/records.mjs';
import { deriveState, computeDashboardFromRecords } from '../domain/derive.mjs';
import { calculateCoreNumbers } from '../domain/totals.mjs';
import { calcDailyBudget, calcEnvelope, validateExpenseAdd } from '../domain/budgets.mjs';
import { groupObligationsByPerson, calculateObligationState, advanceBillCycle } from '../domain/obligations.mjs';
import { projectAtDate } from '../domain/projection.mjs';
import { runInvariantsCheck, generatePythonAuditScript } from '../domain/audit.mjs';
import { renderTrajectoryChart, renderSpendBarChart, renderPoolProportions, attachChartInteractions } from './charts.mjs';
import {
  loadRecordsFromLocalStorage,
  saveRecordsToLocalStorage,
  loadUIPrefsFromLocalStorage,
  saveUIPrefsToLocalStorage,
  clearAllLocalStorageData,
  loadConfigFromLocalStorage,
  loadAllLedgerFromLocalStorage
} from '../storage/sharding.mjs';
import { checkV1Data, migrateV1toV2, migrateV2toV3 } from '../storage/migration.mjs';
import { exportFullBackupJSON, validateAndParseBackup } from '../storage/backup.mjs';

export function initApp(rootElement) {
  // 1. Data bootstrap: Check v3 records, migrate from v2 or v1 if needed, or initialize with seeds
  let records = loadRecordsFromLocalStorage();

  if (!records || !Array.isArray(records) || records.length === 0) {
    // Check if v2 data exists
    const v2Config = loadConfigFromLocalStorage();
    const v2Ledger = loadAllLedgerFromLocalStorage();
    const hasV2Data = v2Config && (
      (Array.isArray(v2Config.pools) && v2Config.pools.length > 0) ||
      (Array.isArray(v2Config.budgets) && v2Config.budgets.length > 0) ||
      v2Ledger.length > 0
    );

    if (hasV2Data) {
      records = migrateV2toV3(v2Config, v2Ledger);
      saveRecordsToLocalStorage(records);
    } else {
      // Check if v1 data exists
      const v1 = checkV1Data();
      if (v1) {
        const v2Migrated = migrateV1toV2(v1.parsed, v1.raw);
        records = migrateV2toV3(v2Migrated.config, v2Migrated.ledgerEntries);
        saveRecordsToLocalStorage(records);
      } else {
        records = createInitialSeedRecords();
        saveRecordsToLocalStorage(records);
      }
    }
  }

  const uiPrefs = loadUIPrefsFromLocalStorage();

  // Application State
  const state = {
    records,
    activeTab: uiPrefs.activeTab || 'overview',
    activeBudgetId: uiPrefs.activeBudgetId || null,
    horizonDate: uiPrefs.horizonDate || getCycleEnd(todayISO(), 1),
    activeModal: null,
    modalData: null,
    editingRecordId: null,
    logFilter: 'all',
    logSearch: '',
    armedClearAll: false,
    clearAllTimer: null
  };

  const uid = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'rec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  };

  function save() {
    saveRecordsToLocalStorage(state.records);
    saveUIPrefsToLocalStorage({
      activeTab: state.activeTab,
      activeBudgetId: state.activeBudgetId,
      horizonDate: state.horizonDate
    });
    syncCloud();
  }

  // Claude Artifact DB Sync (if available)
  async function syncCloud() {
    try {
      if (typeof window !== 'undefined' && window.claude && window.claude.use) {
        const [d, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (!d || !u) return;
        const id = await u.id();
        if (!id) return;
        const docRef = d.collection('data/users/' + id).doc('records');
        await docRef.set({ records: JSON.parse(JSON.stringify(state.records)) });
      }
    } catch (e) {
      console.warn('Claude DB sync deferred:', e);
    }
  }

  // Primary reactive render loop
  function render() {
    const today = todayISO();
    
    // Derive everything dynamically from the single records array
    const derived = deriveState(state.records, today);
    const { config, pools, budgets, obligations, expectedIncomes, transactions } = derived;

    if (!state.activeBudgetId && budgets.length > 0) {
      state.activeBudgetId = budgets[0].id;
    }

    const core = calculateCoreNumbers({
      pools,
      budgets,
      obligations,
      ledgerEntries: transactions,
      horizonDate: state.horizonDate,
      asOfDate: today
    });

    const projection = projectAtDate({
      targetDate: state.horizonDate,
      asOfDate: today,
      pools,
      budgets,
      obligations,
      ledgerEntries: transactions,
      expectedIncomes
    });

    let html = `
      <header class="app-header">
        <div class="logo-area">
          <span class="logo-tag">V3 DATA-LOG</span>
          <h1 class="app-title">BUDGET TRACKER</h1>
        </div>
        <nav class="tab-nav">
          <button class="tab-btn ${state.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
          <button class="tab-btn ${state.activeTab === 'budgets' ? 'active' : ''}" data-tab="budgets">Budgets</button>
          <button class="tab-btn ${state.activeTab === 'people' ? 'active' : ''}" data-tab="people">People</button>
          <button class="tab-btn ${state.activeTab === 'money' ? 'active' : ''}" data-tab="money">Money</button>
          <button class="tab-btn ${state.activeTab === 'analytics' ? 'active' : ''}" data-tab="analytics">Analytics</button>
          <button class="tab-btn ${state.activeTab === 'log' ? 'active' : ''}" data-tab="log">
            Log <span style="font-size:10px;opacity:0.8;">(${state.records.length})</span>
          </button>
          <button class="tab-btn ${state.activeTab === 'add' ? 'active' : ''}" data-tab="add" style="color:var(--acc);font-weight:700;">+ Add</button>
        </nav>
      </header>
    `;

    switch (state.activeTab) {
      case 'budgets':
        html += renderBudgetsTab(derived, core, today);
        break;
      case 'people':
        html += renderPeopleTab(derived, core);
        break;
      case 'money':
        html += renderMoneyTab(derived, core);
        break;
      case 'analytics':
        html += renderAnalyticsTab(derived, core, projection);
        break;
      case 'log':
        html += renderLogTab(derived, core);
        break;
      case 'add':
        html += renderAddTab(derived, core);
        break;
      case 'overview':
      default:
        html += renderOverviewTab(derived, core, projection, today);
        break;
    }

    if (state.activeModal) {
      html += renderModal(state.activeModal, derived, core);
    }

    rootElement.innerHTML = html;
    attachListeners(derived, core);
  }

  // -------------------------------------------------------------
  // TAB 1: OVERVIEW
  // -------------------------------------------------------------
  function renderOverviewTab(derived, core, projection, today) {
    const isUnallocNeg = core.unallocated < 0;
    const isCapNeg = projection.capProjected < 0;
    const { budgets, transactions } = derived;

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

      <!-- Modern Stock-Grade Cash Trajectory Card (Robinhood / Revolut Style) -->
      ${renderTrajectoryChart({
        ...projection,
        currentTotal: core.totalAvailable,
        horizonDate: state.horizonDate
      })}

      <!-- Active Rolling Daily Allowance -->
      ${budgets.filter((b) => b.kind === 'daily').map((b) => {
        const d = calcDailyBudget(b, transactions, today);
        return `
          <section class="card highlight">
            <div class="card-title">
              <span>Daily Rolling Allowance: ${b.name}</span>
              <span class="badge ${d.leftToday < 0 ? 'red' : 'green'}">Day ${d.di + 1} of ${d.N}</span>
            </div>
            <div class="hero-grid" style="margin-bottom:12px;">
              <div>
                <div class="kpi-lbl">Today's Allowance</div>
                <div class="kpi-val ${d.currentAllowance < 0 ? 'bad' : 'good'}">${formatINR(d.currentAllowance)}</div>
                <div class="kpi-sub">Base pace: ${formatINR(d.basePerDay)}/day</div>
              </div>
              <div>
                <div class="kpi-lbl">Spent Today</div>
                <div class="kpi-val">${formatINR(d.spentToday)}</div>
                <div class="kpi-sub">Total spent: ${formatINR(d.spent)}</div>
              </div>
              <div>
                <div class="kpi-lbl">Left Today</div>
                <div class="kpi-val ${d.leftToday < 0 ? 'bad' : 'good'}">${formatINR(d.leftToday)}</div>
                <div class="kpi-sub">Remaining cycle: ${formatINR(d.left)}</div>
              </div>
            </div>
          </section>
        `;
      }).join('')}

      <!-- Recent Transactions Log -->
      <section class="card">
        <div class="card-title">
          <span>Recent Transactions</span>
          <span class="mono" style="font-size:11px;color:var(--mut);">${transactions.length} entries</span>
        </div>
        ${transactions.length === 0 ? `
          <div style="padding:16px 0;color:var(--mut);text-align:center;">No transactions recorded yet. Tap <strong>+ Add</strong> above to record your first expense or income.</div>
        ` : `
          <div style="overflow-x:auto;">
            <table class="table mono" style="font-size:12px;">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th style="text-align:right;">Amount</th>
                  <th style="text-align:center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${transactions.slice(-15).reverse().map((e) => `
                  <tr>
                    <td>${shortDate(e.date)}</td>
                    <td><span class="badge ${e.type === 'income' ? 'green' : e.type === 'expense' ? 'red' : 'yellow'}">${e.type}</span></td>
                    <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                      ${e.note || e.source || '—'}
                    </td>
                    <td style="text-align:right;font-weight:700;color:${e.type === 'income' ? 'var(--acc)' : 'var(--fg)'};">
                      ${formatINR(e.amount)}
                    </td>
                    <td style="text-align:center;">
                      <div class="action-btn-group">
                        <button class="btn-icon" data-action="edit-record" data-id="${e.id}" title="Edit Record">✏️</button>
                        <button class="btn-icon btn-delete" data-action="del-record" data-id="${e.id}" title="Delete Record">&times;</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </section>
    `;
  }

  // -------------------------------------------------------------
  // TAB 2: BUDGETS
  // -------------------------------------------------------------
  function renderBudgetsTab(derived, core, today) {
    const { budgets, transactions } = derived;
    const dailyBudgets = budgets.filter((b) => b.kind === 'daily');
    const envelopes = budgets.filter((b) => b.kind === 'envelope');

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <h2 style="font-size:16px;font-family:var(--font-mono);margin:0;">BUDGETS & ENVELOPES</h2>
        <div style="display:flex;gap:8px;">
          <button class="sec sm" data-action="open-modal" data-modal="allocate">Allocate / Transfer</button>
          <button class="pri sm" data-action="open-modal" data-modal="new-budget">+ New Budget / Envelope</button>
        </div>
      </div>

      <!-- Daily Rolling Budgets -->
      <h3 style="font-size:12px;font-family:var(--font-mono);color:var(--acc);margin:16px 0 8px;text-transform:uppercase;">Daily Rolling Budgets</h3>
      <div class="grid-2">
        ${dailyBudgets.map((b) => {
          const d = calcDailyBudget(b, transactions, today);
          return `
            <div class="card" style="margin:0;">
              <div class="card-title">
                <span>${b.name}</span>
                <div class="action-btn-group">
                  <button class="btn-icon" data-action="edit-record" data-id="${b.id}" title="Edit Budget">✏️</button>
                  <button class="btn-icon btn-delete" data-action="del-record" data-id="${b.id}" title="Delete Budget">&times;</button>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span class="mono">Allowance Today: <strong style="color:var(--acc);">${formatINR(d.currentAllowance)}</strong></span>
                <span class="mono">Cycle Left: <strong>${formatINR(d.left)}</strong></span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width:${Math.min(100, (d.spent / d.B) * 100)}%;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-top:4px;">
                <span>Spent: ${formatINR(d.spent)}</span>
                <span>Budget: ${formatINR(d.B)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Envelopes -->
      <h3 style="font-size:12px;font-family:var(--font-mono);color:var(--sapphire);margin:20px 0 8px;text-transform:uppercase;">Undated Envelopes & Sinking Funds</h3>
      <div class="grid-2">
        ${envelopes.map((env) => {
          const s = calcEnvelope(env, transactions);
          return `
            <div class="card" style="margin:0;">
              <div class="card-title">
                <span>${env.name}</span>
                <div style="display:flex;align-items:center;gap:6px;">
                  ${env.hardCap ? '<span class="badge red">HARD CAP</span>' : ''}
                  <div class="action-btn-group">
                    <button class="btn-icon" data-action="edit-record" data-id="${env.id}" title="Edit Envelope">✏️</button>
                    <button class="btn-icon btn-delete" data-action="del-record" data-id="${env.id}" title="Delete Envelope">&times;</button>
                  </div>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span class="mono">Funded: <strong>${formatINR(s.funded)}</strong></span>
                <span class="mono">Remaining: <strong style="color:${s.left < 0 ? 'var(--bad)' : 'var(--acc)'};">${formatINR(s.left)}</strong></span>
              </div>
              <div class="bar-track">
                <div class="bar-fill ${s.isOverspent ? 'danger' : ''}" style="width:${s.pctSpent}%;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-top:4px;">
                <span>Spent: ${formatINR(s.spent)}</span>
                <span>${s.pctSpent}% utilized</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // -------------------------------------------------------------
  // TAB 3: PEOPLE (Unified Obligations: Debts, Receivables, Bills)
  // -------------------------------------------------------------
  function renderPeopleTab(derived, core) {
    const { obligations, transactions } = derived;
    const people = groupObligationsByPerson(obligations, transactions);
    const bills = obligations.filter((o) => o.role === 'bill');

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <h2 style="font-size:16px;font-family:var(--font-mono);margin:0;">OBLIGATIONS & COUNTERPARTIES</h2>
        <button class="pri sm" data-action="open-modal" data-modal="new-obligation">+ Add Obligation / Bill</button>
      </div>

      <!-- Interpersonal Netting Cards -->
      <h3 style="font-size:12px;font-family:var(--font-mono);color:var(--peach);margin:16px 0 8px;text-transform:uppercase;">Interpersonal Debts & Loans</h3>
      ${people.length === 0 ? `
        <div class="card" style="color:var(--mut);text-align:center;padding:16px;">No interpersonal debts or loans recorded.</div>
      ` : `
        <div class="grid-2">
          ${people.map((p) => {
            const isOwed = p.netBalance > 0;
            const isEven = Math.abs(p.netBalance) < 0.01;
            return `
              <div class="card" style="margin:0;">
                <div class="card-title">
                  <span>${p.person}</span>
                  <span class="badge ${isEven ? 'gray' : isOwed ? 'green' : 'red'}">
                    ${isEven ? 'SETTLED' : isOwed ? 'OWES YOU' : 'YOU OWE'}
                  </span>
                </div>
                <div style="font-size:18px;font-weight:800;font-family:var(--font-mono);color:${isEven ? 'var(--fg)' : isOwed ? 'var(--acc)' : 'var(--bad)'};margin-bottom:10px;">
                  ${formatINR(Math.abs(p.netBalance))}
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="sec sm" data-action="open-repay-modal" data-person="${p.person}">Settle / Repay</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}

      <!-- Institutional Bills -->
      <h3 style="font-size:12px;font-family:var(--font-mono);color:var(--bad);margin:24px 0 8px;text-transform:uppercase;">Recurring Institutional Bills</h3>
      ${bills.length === 0 ? `
        <div class="card" style="color:var(--mut);text-align:center;padding:16px;">No recurring bills configured.</div>
      ` : `
        <div class="card" style="padding:0;overflow:hidden;">
          <table class="table mono" style="font-size:12px;">
            <thead>
              <tr>
                <th>Bill / Provider</th>
                <th>Due Date</th>
                <th>Amount</th>
                <th>Cadence</th>
                <th style="text-align:center;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${bills.map((b) => {
                const s = calculateObligationState(b, transactions);
                return `
                  <tr>
                    <td><strong>${b.counterparty}</strong></td>
                    <td>${b.due ? shortDate(b.due) : '—'}</td>
                    <td>${formatINR(b.principal)}</td>
                    <td>${b.recurrence ? `Every ${b.recurrence.interval} ${b.recurrence.unit}` : 'One-off'}</td>
                    <td style="text-align:center;">
                      <div class="action-btn-group">
                        <button class="btn-icon" data-action="edit-record" data-id="${b.id}" title="Edit Bill">✏️</button>
                        <button class="btn-icon btn-delete" data-action="del-record" data-id="${b.id}" title="Delete Bill">&times;</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  }

  // -------------------------------------------------------------
  // TAB 4: MONEY (Physical Pools & Data Management)
  // -------------------------------------------------------------
  function renderMoneyTab(derived, core) {
    const { pools, transactions } = derived;
    const activePools = core.poolBalances.filter((p) => !p.isArchived);
    const archivedPools = core.poolBalances.filter((p) => p.isArchived);

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <h2 style="font-size:16px;font-family:var(--font-mono);margin:0;">PHYSICAL MONEY POOLS</h2>
        <div style="display:flex;gap:8px;">
          <button class="sec sm" data-action="open-modal" data-modal="reconcile">Reconcile / Adjust</button>
          <button class="pri sm" data-action="open-modal" data-modal="new-pool">+ New Pool</button>
        </div>
      </div>

      <!-- Active Pools List -->
      <div class="grid-3" style="margin-bottom:20px;">
        ${activePools.map((p) => `
          <div class="card" style="margin:0;">
            <div class="card-title">
              <span>${p.name}</span>
              <span class="badge blue">${p.type}</span>
            </div>
            <div class="kpi-val ${p.balance < 0 ? 'bad' : ''}">${formatINR(p.balance)}</div>
            <div class="kpi-sub" style="margin-bottom:10px;">Opening: ${formatINR(p.opening)}</div>
            <div style="display:flex;gap:4px;">
              <button class="sec sm" data-action="edit-record" data-id="${p.id}">Edit</button>
              <button class="sec sm" data-action="archive-pool" data-id="${p.id}" style="color:var(--mut);">Archive</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Archived Pools (if any) -->
      ${archivedPools.length > 0 ? `
        <div class="card" style="margin-bottom:20px;">
          <div class="card-title" style="color:var(--mut);">
            <span>Archived Pools (${archivedPools.length})</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${archivedPools.map((p) => `
              <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:6px;">
                <div>
                  <strong>${p.name}</strong> <span class="badge gray">Archived</span>
                  <div style="font-size:11px;color:var(--mut);">Historical balance: ${formatINR(p.balance)}</div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="sec sm" data-action="unarchive-pool" data-id="${p.id}">Restore</button>
                  <button class="btn-icon btn-delete" data-action="del-record" data-id="${p.id}" title="Delete Record">&times;</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- System Verification & Audit -->
      <section class="card" style="margin-bottom:20px;">
        <div class="card-title" style="color:var(--sapphire);">
          <span>Independent Mathematical Audit & Health</span>
        </div>
        <p style="font-size:12px;color:var(--mut);margin:0 0 10px;">
          Verify mathematical parity using the independent Python audit engine or test live runtime invariants.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="pri sm" id="btn-export-python">Export Python Audit Script (verify_ledger.py)</button>
          <button class="sec sm" data-action="open-modal" data-modal="invariants">Run In-Browser Health Check</button>
        </div>
      </section>

      <!-- Data Management: JSON Backup, Restore, Factory Reset -->
      <section class="card">
        <div class="card-title" style="color:var(--peach);">
          <span>Data Storage & Portability</span>
        </div>
        <p style="font-size:12px;color:var(--mut);margin:0 0 12px;">
          All records live in local storage on this device. Back up or transfer data at any time.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <button class="sec sm" id="btn-backup-export">Export Full Backup (JSON)</button>
          <label class="btn sec sm" style="cursor:pointer;margin:0;">
            Restore from Backup (JSON)
            <input type="file" id="input-backup-restore" accept=".json" style="display:none;">
          </label>
          <button class="btn-danger sm ${state.armedClearAll ? 'btn-danger-armed' : ''}" id="btn-clear-all">
            ${state.armedClearAll ? 'CONFIRM CLEAR ALL DATA (CLICK AGAIN)' : 'Clear All Data (Factory Reset)'}
          </button>
        </div>
      </section>
    `;
  }

  // -------------------------------------------------------------
  // TAB 5: ANALYTICS
  // -------------------------------------------------------------
  function renderAnalyticsTab(derived, core, projection) {
    const { pools, budgets, transactions } = derived;

    return `
      <h2 style="font-size:16px;font-family:var(--font-mono);margin:0 0 14px;">VISUAL ANALYTICS & PROJECTIONS</h2>
      
      <!-- Trajectory Chart -->
      <section style="margin-bottom:20px;">
        ${renderTrajectoryChart({
          ...projection,
          currentTotal: core.totalAvailable,
          horizonDate: state.horizonDate
        })}
      </section>

      <!-- Spend vs Funded Bar Chart -->
      <section class="card" style="margin-bottom:20px;">
        <div class="card-title" style="color:var(--acc);">Spend vs. Funded Envelopes</div>
        ${renderSpendBarChart({ budgetDetails: core.budgetDetails, budgets, transactions })}
      </section>

      <!-- Physical Pool Allocation Proportion -->
      <section class="card">
        <div class="card-title" style="color:var(--sapphire);">Physical Asset Allocation</div>
        ${renderPoolProportions({ poolBalances: core.poolBalances })}
      </section>
    `;
  }

  // -------------------------------------------------------------
  // TAB 6: LOG (The Universal Unified Record Stream)
  // -------------------------------------------------------------
  function renderLogTab(derived, core) {
    const filter = state.logFilter;
    const search = (state.logSearch || '').toLowerCase().trim();

    let filtered = [...state.records];

    // Filter by category/type
    if (filter === 'transactions') {
      filtered = filtered.filter((r) => TRANSACTION_TYPES.has(r.type));
    } else if (filter === 'entities') {
      filtered = filtered.filter((r) => ENTITY_TYPES.has(r.type));
    } else if (filter !== 'all') {
      filtered = filtered.filter((r) => r.type === filter);
    }

    // Filter by search query
    if (search) {
      filtered = filtered.filter((r) => {
        const str = JSON.stringify(r).toLowerCase();
        return str.includes(search);
      });
    }

    // Sort newest date first
    filtered.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.ts || '').localeCompare(a.ts || '');
    });

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <h2 style="font-size:16px;font-family:var(--font-mono);margin:0;">UNIFIED RECORD TIMELINE</h2>
        <div style="display:flex;gap:8px;">
          <button class="pri sm" data-action="tab-switch" data-target="add">+ Add Record</button>
          <button class="btn-danger sm ${state.armedClearAll ? 'btn-danger-armed' : ''}" id="btn-log-clear-all">
            ${state.armedClearAll ? 'CONFIRM CLEAR ALL' : 'Clear All'}
          </button>
        </div>
      </div>

      <!-- Toolbar: Filters & Search -->
      <div class="log-toolbar">
        <select class="log-filter-select" id="log-type-filter">
          <option value="all" ${filter === 'all' ? 'selected' : ''}>All Records (${state.records.length})</option>
          <option value="transactions" ${filter === 'transactions' ? 'selected' : ''}>Transactions Only</option>
          <option value="entities" ${filter === 'entities' ? 'selected' : ''}>Entities Only (Pools, Budgets, etc.)</option>
          <option disabled>──────────</option>
          <option value="expense" ${filter === 'expense' ? 'selected' : ''}>Expense</option>
          <option value="income" ${filter === 'income' ? 'selected' : ''}>Income</option>
          <option value="transfer" ${filter === 'transfer' ? 'selected' : ''}>Transfer</option>
          <option value="pool" ${filter === 'pool' ? 'selected' : ''}>Pool</option>
          <option value="budget" ${filter === 'budget' ? 'selected' : ''}>Budget</option>
          <option value="obligation" ${filter === 'obligation' ? 'selected' : ''}>Obligation</option>
          <option value="expected-income" ${filter === 'expected-income' ? 'selected' : ''}>Expected Income</option>
          <option value="config" ${filter === 'config' ? 'selected' : ''}>Config</option>
        </select>
        <input type="text" class="log-search-input" id="log-search-box" placeholder="Search records by text, note, amount, id..." value="${state.logSearch}">
      </div>

      <!-- Record List Stream -->
      ${filtered.length === 0 ? `
        <div class="card" style="text-align:center;padding:32px;color:var(--mut);">
          <div style="font-size:16px;font-weight:700;margin-bottom:8px;">No records match your criteria.</div>
          ${state.records.length === 0 ? `
            <p>Your database is completely empty.</p>
            <button class="pri sm" id="btn-seed-defaults" style="margin-top:8px;">Re-seed Default Accounts & Budgets</button>
          ` : `
            <p>Try clearing your search query or switching filters.</p>
          `}
        </div>
      ` : `
        <div class="record-list">
          ${filtered.map((r) => {
            const d = r.data || {};
            let details = '';
            if (r.type === 'expense') {
              details = `Amount: ${formatINR(d.amount)} | ${d.note || 'Expense'}`;
            } else if (r.type === 'income') {
              details = `Amount: +${formatINR(d.amount)} | ${d.source || d.note || 'Income'}`;
            } else if (r.type === 'transfer') {
              details = `Amount: ${formatINR(d.amount)} | ${d.note || 'Transfer'}`;
            } else if (r.type === 'pool') {
              details = `Pool "${d.name}" (${d.poolType || d.type || 'bank'}) | Opening: ${formatINR(d.opening || 0)}`;
            } else if (r.type === 'budget') {
              details = `Budget "${d.name}" (${d.kind || 'envelope'}) | ${d.amount ? formatINR(d.amount) : 'Envelope'}`;
            } else if (r.type === 'obligation') {
              details = `Obligation "${d.counterparty}" (${d.role}) | Principal: ${formatINR(d.principal)}`;
            } else if (r.type === 'expected-income') {
              details = `Expected Income "${d.source}" | ${formatINR(d.amount)}`;
            } else if (r.type === 'config') {
              details = `System Config | Cycle Start Day: ${d.cycleStartDay || 1}`;
            } else {
              details = JSON.stringify(d);
            }

            return `
              <div class="record-card type-${r.type}">
                <div class="record-meta">
                  <span class="record-date">${shortDate(r.date)}</span>
                  <span class="record-type-pill">${r.type}</span>
                </div>
                <div class="record-body">
                  <span class="record-main">${details}</span>
                  <span class="record-sub">ID: ${r.id.slice(0, 8)}</span>
                </div>
                <div class="record-actions">
                  <button class="btn-icon" data-action="edit-record" data-id="${r.id}" title="Edit Record">✏️</button>
                  <button class="btn-icon btn-delete" data-action="del-record" data-id="${r.id}" title="Delete Record">&times;</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    `;
  }

  // -------------------------------------------------------------
  // TAB 7: + ADD (Quick Entry)
  // -------------------------------------------------------------
  function renderAddTab(derived, core) {
    const { pools, budgets } = derived;

    return `
      <section class="card" style="max-width:540px;margin:0 auto;">
        <div class="card-title">
          <span>Quick Record Entry</span>
          <span class="badge green">Append to Log</span>
        </div>
        <form id="qa-form">
          <div class="form-row">
            <div>
              <label>Transaction Type</label>
              <select id="qa-type">
                <option value="expense">Expense (Spend)</option>
                <option value="income">Income (Deposit)</option>
                <option value="transfer">Transfer between Pools</option>
                <option value="loan_out">Loan Given (They owe you)</option>
                <option value="loan_in">Loan Taken (You owe them)</option>
              </select>
            </div>
            <div>
              <label>Amount (₹)</label>
              <input id="qa-amt" type="number" min="0.01" step="any" placeholder="0" required autofocus>
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
              <label id="qa-pool-lbl">Physical Pool</label>
              <select id="qa-pool">
                ${pools.filter((p) => !p.isArchived).map((p) => {
                  const bal = core.poolBalances.find((cb) => cb.id === p.id)?.balance || 0;
                  return `<option value="${p.id}">${p.name} (${formatINR(bal)})</option>`;
                }).join('')}
              </select>
            </div>
            <div id="qa-to-pool-col" style="display:none;">
              <label>Destination Pool</label>
              <select id="qa-to-pool">
                ${pools.filter((p) => !p.isArchived).map((p) => {
                  const bal = core.poolBalances.find((cb) => cb.id === p.id)?.balance || 0;
                  return `<option value="${p.id}">${p.name} (${formatINR(bal)})</option>`;
                }).join('')}
              </select>
            </div>
          </div>

          <div class="form-row" id="qa-counterparty-row" style="display:none;">
            <div>
              <label>Counterparty (Person Name)</label>
              <input id="qa-person" type="text" placeholder="e.g. Alice, Bob">
            </div>
          </div>

          <div class="form-row">
            <div>
              <label>Date</label>
              <input id="qa-date" type="date" value="${todayISO()}">
            </div>
            <div>
              <label>Note / Description</label>
              <input id="qa-note" type="text" placeholder="Groceries, Fuel, etc.">
            </div>
          </div>

          <div id="qa-err" style="color:var(--bad);font-family:var(--font-mono);font-size:12px;margin-bottom:8px;"></div>
          <button class="pri" type="submit" style="width:100%;">Record Entry</button>
        </form>
      </section>
    `;
  }

  // -------------------------------------------------------------
  // MODALS RENDERER
  // -------------------------------------------------------------
  function renderModal(modalName, derived, core) {
    const { pools, budgets, obligations } = derived;
    let content = '';

    if (modalName === 'invariants') {
      const check = runInvariantsCheck(state.records);
      content = `
        <div class="modal-header">
          <h3 class="modal-title">System Invariants & Mathematical Health</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <div style="margin-bottom:12px;font-size:12px;color:var(--mut);">
          Evaluated at: ${check.timestamp}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${check.checks.map((c) => `
            <div style="display:flex;justify-content:space-between;padding:8px;background:var(--card);border:1px solid var(--line);">
              <div>
                <strong style="color:var(--fg);">${c.name}</strong>
                <div style="font-size:11px;color:var(--mut);">${c.detail}</div>
              </div>
              <span class="badge ${c.status === 'pass' ? 'green' : 'red'}">${c.status.toUpperCase()}</span>
            </div>
          `).join('')}
        </div>
        <div style="margin-top:14px;text-align:right;">
          <button class="sec sm" data-action="close-modal">Close</button>
        </div>
      `;
    } else if (modalName === 'edit-record') {
      const rec = state.records.find((r) => r.id === state.editingRecordId);
      if (!rec) {
        content = `
          <div class="modal-header">
            <h3 class="modal-title">Record Not Found</h3>
            <button class="sm ghost" data-action="close-modal">&times;</button>
          </div>
          <p>The selected record could not be found.</p>
        `;
      } else {
        const d = rec.data || {};
        content = `
          <div class="modal-header">
            <h3 class="modal-title">Edit Record: ${rec.type.toUpperCase()}</h3>
            <button class="sm ghost" data-action="close-modal">&times;</button>
          </div>
          <form id="modal-form-edit-record">
            <input type="hidden" id="edit-rec-id" value="${rec.id}">
            <div class="form-row">
              <div>
                <label>Record Type</label>
                <input type="text" id="edit-rec-type" value="${rec.type}" readonly style="opacity:0.7;">
              </div>
              <div>
                <label>Effective Date</label>
                <input type="date" id="edit-rec-date" value="${rec.date}" required>
              </div>
            </div>

            <!-- Dynamic Fields Based on Record Type -->
            ${'amount' in d ? `
              <div class="form-row">
                <div>
                  <label>Amount (₹)</label>
                  <input type="number" step="any" id="edit-rec-amt" value="${d.amount || 0}" required>
                </div>
              </div>
            ` : ''}

            ${'poolId' in d ? `
              <div class="form-row">
                <div>
                  <label>Physical Pool</label>
                  <select id="edit-rec-pool">
                    ${pools.map((p) => `<option value="${p.id}" ${d.poolId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
                  </select>
                </div>
                ${'toPoolId' in d ? `
                  <div>
                    <label>Destination Pool</label>
                    <select id="edit-rec-topool">
                      ${pools.map((p) => `<option value="${p.id}" ${d.toPoolId === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
                    </select>
                  </div>
                ` : ''}
              </div>
            ` : ''}

            ${'budgetId' in d ? `
              <div class="form-row">
                <div>
                  <label>Budget / Envelope</label>
                  <select id="edit-rec-budget">
                    <option value="">(None)</option>
                    ${budgets.map((b) => `<option value="${b.id}" ${d.budgetId === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
                  </select>
                </div>
              </div>
            ` : ''}

            ${'name' in d ? `
              <div class="form-row">
                <div>
                  <label>Name</label>
                  <input type="text" id="edit-rec-name" value="${d.name || ''}" required>
                </div>
              </div>
            ` : ''}

            ${'opening' in d ? `
              <div class="form-row">
                <div>
                  <label>Opening Balance (₹)</label>
                  <input type="number" step="any" id="edit-rec-opening" value="${d.opening || 0}">
                </div>
              </div>
            ` : ''}

            ${'counterparty' in d ? `
              <div class="form-row">
                <div>
                  <label>Counterparty</label>
                  <input type="text" id="edit-rec-counterparty" value="${d.counterparty || ''}">
                </div>
              </div>
            ` : ''}

            ${'principal' in d ? `
              <div class="form-row">
                <div>
                  <label>Principal Amount (₹)</label>
                  <input type="number" step="any" id="edit-rec-principal" value="${d.principal || 0}">
                </div>
              </div>
            ` : ''}

            ${'note' in d || 'source' in d ? `
              <div class="form-row">
                <div>
                  <label>Note / Source</label>
                  <input type="text" id="edit-rec-note" value="${d.note || d.source || ''}">
                </div>
              </div>
            ` : ''}

            <!-- Advanced Raw JSON Editor -->
            <div style="margin-top:10px;">
              <label style="display:flex;justify-content:space-between;align-items:center;">
                <span>Raw Data Payload (JSON)</span>
                <span style="font-size:10px;color:var(--mut);">Advanced</span>
              </label>
              <textarea id="edit-rec-json" rows="4" class="mono" style="width:100%;font-size:11px;background:#000;color:var(--fg);border:1px solid var(--line);">${JSON.stringify(d, null, 2)}</textarea>
            </div>

            <div style="display:flex;gap:8px;margin-top:14px;">
              <button class="pri sm" type="submit" style="flex:1;">Save Changes</button>
              <button class="sec sm" type="button" data-action="close-modal">Cancel</button>
            </div>
          </form>
        `;
      }
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
              <input id="np-name" type="text" placeholder="e.g. HDFC Salary, Emergency Cash" required autofocus>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Account Type</label>
              <select id="np-type">
                <option value="bank">Bank Account</option>
                <option value="cash">Cash in Hand</option>
                <option value="upi">UPI / Digital Wallet</option>
                <option value="other">Other Asset</option>
              </select>
            </div>
            <div>
              <label>Opening Balance (₹)</label>
              <input id="np-opening" type="number" step="any" value="0" required>
            </div>
          </div>
          <button class="pri" type="submit" style="width:100%;">Create Pool</button>
        </form>
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
              <input id="nb-name" type="text" placeholder="e.g. Groceries, Fuel" required autofocus>
            </div>
            <div>
              <label>Kind</label>
              <select id="nb-kind">
                <option value="envelope">Envelope (Undated)</option>
                <option value="daily">Daily Rolling Budget</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Initial Funded Amount (₹)</label>
              <input id="nb-amt" type="number" step="any" value="0" required>
            </div>
          </div>
          <div class="form-row" id="nb-cap-row">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="nb-hardcap">
              <span>Hard Cap (Block spends when exhausted)</span>
            </label>
          </div>
          <button class="pri" type="submit" style="width:100%;">Create Budget</button>
        </form>
      `;
    } else if (modalName === 'new-obligation') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Add Obligation or Recurring Bill</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-new-obligation">
          <div class="form-row">
            <div>
              <label>Role</label>
              <select id="mo-role">
                <option value="bill">Recurring Fixed Bill (Rent, Electricity)</option>
                <option value="debt">Debt (You owe someone)</option>
                <option value="receivable">Loan / Receivable (Someone owes you)</option>
              </select>
            </div>
            <div>
              <label>Counterparty / Provider</label>
              <input id="mo-person" type="text" placeholder="e.g. Landlord, Bob" required autofocus>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Amount (₹)</label>
              <input id="mo-amt" type="number" step="any" placeholder="0" required>
            </div>
            <div>
              <label>Next Due Date</label>
              <input id="mo-due" type="date">
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
                ${budgets.map((b) => `<option value="${b.id}">Budget: ${b.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Destination Budget / Envelope</label>
              <select id="mal-to">
                ${budgets.map((b) => `<option value="${b.id}">${b.name} (${b.kind})</option>`).join('')}
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
      const personObs = obligations.filter((o) =>
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
                    const s = calculateObligationState(o, derived.transactions);
                    return `<option value="${o.id}">${o.direction === 'receive' ? 'They owe me' : 'I owe them'}: ${formatINR(s.outstanding)} (${o.note || o.role})</option>`;
                  }).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div>
                <label>Pool Used</label>
                <select id="mrp-pool">
                  ${pools.map((p) => {
                    const bal = core.poolBalances.find((cb) => cb.id === p.id)?.balance || 0;
                    return `<option value="${p.id}">${p.name} (${formatINR(bal)})</option>`;
                  }).join('')}
                </select>
              </div>
              <div>
                <label>Amount (₹)</label>
                <input id="mrp-amt" type="number" step="any" required autofocus>
              </div>
            </div>
            <div class="form-row">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" id="mrp-forgive">
                <span>Forgive remaining balance (No cash exchange)</span>
              </label>
            </div>
            <button class="pri" type="submit" style="width:100%;">Record Settlement</button>
          </form>
        ` : `
          <p style="color:var(--mut);">No active obligations found for ${person}.</p>
        `}
      `;
    } else if (modalName === 'reconcile') {
      content = `
        <div class="modal-header">
          <h3 class="modal-title">Reconcile Pool Balance</h3>
          <button class="sm ghost" data-action="close-modal">&times;</button>
        </div>
        <form id="modal-form-reconcile">
          <div class="form-row">
            <div>
              <label>Select Physical Pool</label>
              <select id="mrc-pool">
                ${pools.filter((p) => !p.isArchived).map((p) => {
                  const bal = core.poolBalances.find((cb) => cb.id === p.id)?.balance || 0;
                  return `<option value="${p.id}">${p.name} (Calculated: ${formatINR(bal)})</option>`;
                }).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Actual Verified Balance (₹)</label>
              <input id="mrc-target" type="number" step="any" placeholder="Enter bank/cash amount" required autofocus>
            </div>
          </div>
          <div class="form-row">
            <div>
              <label>Reason / Note</label>
              <input id="mrc-note" type="text" placeholder="Audit adjustment, cash recount, etc.">
            </div>
          </div>
          <button class="pri" type="submit" style="width:100%;">Post Adjustment</button>
        </form>
      `;
    }

    return `
      <div class="modal-overlay" id="modal-backdrop">
        <div class="modal-content" onclick="event.stopPropagation();">
          ${content}
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // EVENT LISTENERS & DISPATCHERS
  // -------------------------------------------------------------
  function attachListeners(derived, core) {
    // Tab switching
    rootElement.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        state.activeTab = e.currentTarget.getAttribute('data-tab');
        save();
        render();
      });
    });

    rootElement.querySelectorAll('[data-action="tab-switch"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        state.activeTab = e.currentTarget.getAttribute('data-target');
        save();
        render();
      });
    });

    // Modal triggers
    rootElement.querySelectorAll('[data-action="open-modal"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        state.activeModal = e.currentTarget.getAttribute('data-modal');
        render();
      });
    });

    rootElement.querySelectorAll('[data-action="open-repay-modal"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        state.activeModal = 'repay';
        state.modalData = { person: e.currentTarget.getAttribute('data-person') };
        render();
      });
    });

    rootElement.querySelectorAll('[data-action="close-modal"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeModal = null;
        state.modalData = null;
        state.editingRecordId = null;
        render();
      });
    });

    const backdrop = rootElement.querySelector('#modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        state.activeModal = null;
        state.modalData = null;
        state.editingRecordId = null;
        render();
      });
    }

    // Horizon forecaster controls
    const datePicker = rootElement.querySelector('#horizon-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        if (e.target.value) {
          state.horizonDate = e.target.value;
          save();
          render();
        }
      });
    }

    rootElement.querySelectorAll('[data-set-days]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const days = Number(e.currentTarget.getAttribute('data-set-days'));
        state.horizonDate = addDays(todayISO(), days);
        save();
        render();
      });
    });

    rootElement.querySelectorAll('[data-set-cycle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.horizonDate = getCycleEnd(todayISO(), derived.config.cycleStartDay || 1);
        save();
        render();
      });
    });

    // Universal Record Edit Action
    rootElement.querySelectorAll('[data-action="edit-record"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        state.editingRecordId = id;
        state.activeModal = 'edit-record';
        render();
      });
    });

    // Universal Record Delete Action
    rootElement.querySelectorAll('[data-action="del-record"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        state.records = deleteRecord(state.records, id);
        save();
        render();
      });
    });

    // Legacy delete support
    rootElement.querySelectorAll('[data-action="del-ledger-entry"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        state.records = deleteRecord(state.records, id);
        save();
        render();
      });
    });

    // Archive Pool Action
    rootElement.querySelectorAll('[data-action="archive-pool"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const poolId = e.currentTarget.getAttribute('data-id');
        state.records = editRecord(state.records, poolId, { data: { isArchived: true } });
        save();
        render();
      });
    });

    // Restore / Unarchive Pool Action
    rootElement.querySelectorAll('[data-action="unarchive-pool"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const poolId = e.currentTarget.getAttribute('data-id');
        state.records = editRecord(state.records, poolId, { data: { isArchived: false } });
        save();
        render();
      });
    });

    // Log Tab Search & Filter
    const filterSelect = rootElement.querySelector('#log-type-filter');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        state.logFilter = e.target.value;
        render();
      });
    }

    const searchBox = rootElement.querySelector('#log-search-box');
    if (searchBox) {
      searchBox.addEventListener('input', (e) => {
        state.logSearch = e.target.value;
        // Keep focus
        const pos = e.target.selectionStart;
        render();
        const updatedBox = rootElement.querySelector('#log-search-box');
        if (updatedBox) {
          updatedBox.focus();
          updatedBox.setSelectionRange(pos, pos);
        }
      });
    }

    // Re-seed default accounts button
    const btnSeed = rootElement.querySelector('#btn-seed-defaults');
    if (btnSeed) {
      btnSeed.addEventListener('click', () => {
        state.records = createInitialSeedRecords();
        save();
        render();
      });
    }

    // Clear All Records Button (Two-Step Confirmation)
    const handleClearAllClick = () => {
      if (!state.armedClearAll) {
        state.armedClearAll = true;
        render();
        if (state.clearAllTimer) clearTimeout(state.clearAllTimer);
        state.clearAllTimer = setTimeout(() => {
          state.armedClearAll = false;
          render();
        }, 4000);
      } else {
        if (state.clearAllTimer) clearTimeout(state.clearAllTimer);
        state.armedClearAll = false;
        state.records = clearAllRecords();
        clearAllLocalStorageData();
        save();
        render();
      }
    };

    const btnClearAll = rootElement.querySelector('#btn-clear-all');
    if (btnClearAll) btnClearAll.addEventListener('click', handleClearAllClick);

    const btnLogClearAll = rootElement.querySelector('#btn-log-clear-all');
    if (btnLogClearAll) btnLogClearAll.addEventListener('click', handleClearAllClick);

    // Export Python Audit Script
    const btnPy = rootElement.querySelector('#btn-export-python');
    if (btnPy) {
      btnPy.addEventListener('click', () => {
        const pyScript = generatePythonAuditScript(state.records, null, state.horizonDate);
        const blob = new Blob([pyScript], { type: 'text/x-python' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'verify_ledger.py';
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Backup & Restore
    const btnBackup = rootElement.querySelector('#btn-backup-export');
    if (btnBackup) {
      btnBackup.addEventListener('click', () => {
        const jsonStr = exportFullBackupJSON(state.records);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `budget-tracker-backup-${todayISO()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    const inputRestore = rootElement.querySelector('#input-backup-restore');
    if (inputRestore) {
      inputRestore.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const restored = validateAndParseBackup(evt.target.result);
            if (restored && Array.isArray(restored.records)) {
              state.records = restored.records;
              save();
              render();
              alert(`Successfully restored ${restored.records.length} records!`);
            }
          } catch (err) {
            alert('Restore failed: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    }

    // Form: Edit Record Modal Submission
    const editForm = rootElement.querySelector('#modal-form-edit-record');
    if (editForm) {
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = rootElement.querySelector('#edit-rec-id').value;
        const date = rootElement.querySelector('#edit-rec-date').value;
        const jsonArea = rootElement.querySelector('#edit-rec-json');

        let data = {};
        if (jsonArea) {
          try {
            data = JSON.parse(jsonArea.value);
          } catch (err) {
            alert('Invalid JSON in raw data editor: ' + err.message);
            return;
          }
        }

        // Apply any specific field overrides from inputs
        const amtInput = rootElement.querySelector('#edit-rec-amt');
        if (amtInput) data.amount = Number(amtInput.value) || 0;

        const poolSelect = rootElement.querySelector('#edit-rec-pool');
        if (poolSelect) data.poolId = poolSelect.value;

        const toPoolSelect = rootElement.querySelector('#edit-rec-topool');
        if (toPoolSelect) data.toPoolId = toPoolSelect.value;

        const budgetSelect = rootElement.querySelector('#edit-rec-budget');
        if (budgetSelect) data.budgetId = budgetSelect.value || null;

        const nameInput = rootElement.querySelector('#edit-rec-name');
        if (nameInput) data.name = nameInput.value.trim();

        const openingInput = rootElement.querySelector('#edit-rec-opening');
        if (openingInput) data.opening = Number(openingInput.value) || 0;

        const counterpartyInput = rootElement.querySelector('#edit-rec-counterparty');
        if (counterpartyInput) data.counterparty = counterpartyInput.value.trim();

        const principalInput = rootElement.querySelector('#edit-rec-principal');
        if (principalInput) data.principal = Number(principalInput.value) || 0;

        const noteInput = rootElement.querySelector('#edit-rec-note');
        if (noteInput) {
          if ('note' in data) data.note = noteInput.value.trim();
          else if ('source' in data) data.source = noteInput.value.trim();
        }

        state.records = editRecord(state.records, id, { date, data });
        state.activeModal = null;
        state.editingRecordId = null;
        save();
        render();
      });
    }

    // Form: Quick Add
    const qaForm = rootElement.querySelector('#qa-form');
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
          const budget = derived.budgets.find((b) => b.id === budgetId);
          if (budget) {
            const check = validateExpenseAdd(budget, amt, derived.transactions);
            if (!check.allowed) {
              errDiv.textContent = check.reason;
              return;
            }
          }
          state.records.push(createRecord('expense', date, { amount: amt, poolId, budgetId, note }));
        } else if (type === 'income') {
          state.records.push(createRecord('income', date, { amount: amt, poolId, source: note || 'Income', note }));
        } else if (type === 'transfer') {
          const toPoolId = rootElement.querySelector('#qa-to-pool').value;
          if (toPoolId === poolId) {
            errDiv.textContent = 'Source and destination pools must be different.';
            return;
          }
          state.records.push(createRecord('transfer', date, { amount: amt, poolId, toPoolId, note }));
        } else if (type === 'loan_out') {
          const person = rootElement.querySelector('#qa-person').value.trim() || 'Friend';
          const obId = uid();
          state.records.push(createRecord('obligation', date, {
            role: 'receivable',
            counterparty: person,
            direction: 'receive',
            principal: amt,
            status: 'confirmed',
            likelihood: 100,
            note
          }, obId));
          state.records.push(createRecord('loan-out', date, { amount: amt, poolId, obligationId: obId, note }));
        } else if (type === 'loan_in') {
          const person = rootElement.querySelector('#qa-person').value.trim() || 'Friend';
          const obId = uid();
          state.records.push(createRecord('obligation', date, {
            role: 'debt',
            counterparty: person,
            direction: 'pay',
            principal: amt,
            status: 'confirmed',
            likelihood: 100,
            note
          }, obId));
          state.records.push(createRecord('loan-in', date, { amount: amt, poolId, obligationId: obId, note }));
        }

        save();
        state.activeTab = 'overview';
        render();
      });
    }

    // Form: Create Pool
    const mPoolForm = rootElement.querySelector('#modal-form-new-pool');
    if (mPoolForm) {
      mPoolForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = rootElement.querySelector('#np-name').value.trim();
        const type = rootElement.querySelector('#np-type').value;
        const opening = Number(rootElement.querySelector('#np-opening').value) || 0;

        state.records.push(createRecord('pool', todayISO(), {
          name,
          poolType: type,
          opening,
          isArchived: false
        }));

        state.activeModal = null;
        save();
        render();
      });
    }

    // Form: Create Budget
    const mBudgetForm = rootElement.querySelector('#modal-form-new-budget');
    if (mBudgetForm) {
      mBudgetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = rootElement.querySelector('#nb-name').value.trim();
        const kind = rootElement.querySelector('#nb-kind').value;
        const amt = Number(rootElement.querySelector('#nb-amt').value) || 0;
        const hardCap = rootElement.querySelector('#nb-hardcap').checked;
        const firstPoolId = derived.pools[0]?.id || 'pool-bank';

        state.records.push(createRecord('budget', todayISO(), {
          name,
          kind,
          amount: amt,
          days: 30,
          start: todayISO(),
          funding: [{ poolId: firstPoolId, amount: amt }],
          hardCap,
          refillMonthly: false,
          refillAmount: 0
        }));

        state.activeModal = null;
        save();
        render();
      });
    }

    // Form: Create Obligation / Bill
    const mObForm = rootElement.querySelector('#modal-form-new-obligation');
    if (mObForm) {
      mObForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const role = rootElement.querySelector('#mo-role').value;
        const person = rootElement.querySelector('#mo-person').value.trim();
        const amt = Number(rootElement.querySelector('#mo-amt').value) || 0;
        const due = rootElement.querySelector('#mo-due').value || null;
        const cadence = rootElement.querySelector('#mo-cadence').value;

        let recurrence = null;
        if (cadence !== 'none') {
          const [intervalStr, unit] = cadence.split('-');
          recurrence = {
            interval: Number(intervalStr) || 1,
            unit: unit || 'months',
            anchorDate: due || todayISO()
          };
        }

        state.records.push(createRecord('obligation', todayISO(), {
          role,
          counterparty: person,
          direction: role === 'receivable' ? 'receive' : 'pay',
          principal: amt,
          due,
          status: 'confirmed',
          likelihood: 100,
          recurrence,
          funding: []
        }));

        state.activeModal = null;
        save();
        render();
      });
    }

    // Form: Allocate Funds
    const mAllocForm = rootElement.querySelector('#modal-form-allocate');
    if (mAllocForm) {
      mAllocForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fromVal = rootElement.querySelector('#mal-from').value;
        const toVal = rootElement.querySelector('#mal-to').value;
        const amt = Number(rootElement.querySelector('#mal-amt').value) || 0;
        const errDiv = rootElement.querySelector('#mal-err');

        if (!(amt > 0)) {
          errDiv.textContent = 'Please enter a valid amount > 0.';
          return;
        }

        const fromBudgetId = fromVal === 'unallocated' ? null : fromVal;
        state.records.push(createRecord('allocation', todayISO(), {
          amount: amt,
          fromBudgetId,
          toBudgetId: toVal,
          note: `Transferred ${fromVal === 'unallocated' ? 'Unallocated' : 'Budget'} to Budget`
        }));

        state.activeModal = null;
        save();
        render();
      });
    }

    // Form: Repay / Settle
    const mRepayForm = rootElement.querySelector('#modal-form-repay');
    if (mRepayForm) {
      mRepayForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const obId = rootElement.querySelector('#mrp-ob').value;
        const poolId = rootElement.querySelector('#mrp-pool').value;
        const amt = Number(rootElement.querySelector('#mrp-amt').value) || 0;
        const isForgive = rootElement.querySelector('#mrp-forgive').checked;

        const ob = derived.obligations.find((o) => o.id === obId);
        if (!ob) return;

        if (isForgive) {
          state.records = editRecord(state.records, obId, { data: { status: 'forgiven' } });
        } else {
          state.records.push(createRecord('repayment', todayISO(), {
            amount: amt,
            poolId,
            obligationId: obId,
            direction: ob.direction === 'receive' ? 'in' : 'out',
            note: `Settlement with ${ob.counterparty}`
          }));
        }

        state.activeModal = null;
        state.modalData = null;
        save();
        render();
      });
    }

    // Form: Reconcile Pool Balance Adjustment
    const mReconcileForm = rootElement.querySelector('#modal-form-reconcile');
    if (mReconcileForm) {
      mReconcileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const poolId = rootElement.querySelector('#mrc-pool').value;
        const target = Number(rootElement.querySelector('#mrc-target').value);
        const note = rootElement.querySelector('#mrc-note').value.trim() || 'Audit reconciliation';

        if (isNaN(target)) return;

        state.records.push(createRecord('adjustment', todayISO(), {
          poolId,
          targetBalance: target,
          note
        }));

        state.activeModal = null;
        save();
        render();
      });
    }

    // Attach chart scrubber listeners
    attachChartInteractions(rootElement);
  }

  // Initial boot
  render();
}
