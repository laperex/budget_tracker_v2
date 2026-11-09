import { DEFAULT_POOLS, DEFAULT_ENVELOPES } from '../domain/types.mjs';

export const V1_STORAGE_KEY = 'budget-tracker-v1';
export const V1_BACKUP_KEY = 'budget-tracker-v1-backup';

/**
 * Checks if v1 data exists and has not yet been migrated.
 */
export function checkV1Data() {
  try {
    const raw = localStorage.getItem(V1_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.budgets) && parsed.budgets.length > 0) {
      return { raw, parsed };
    }
  } catch (err) {
    console.warn('Error reading v1 data:', err);
  }
  return null;
}

/**
 * Migrates a v1 state blob into v2 config and ledger entries.
 * Returns { config, ledgerEntries, backupSaved: boolean }
 */
export function migrateV1toV2(v1Data, rawV1String = null) {
  if (rawV1String) {
    try {
      localStorage.setItem(V1_BACKUP_KEY, rawV1String);
    } catch (e) {}
  }

  const v2Budgets = [];
  const ledgerEntries = [];
  const pools = [...DEFAULT_POOLS];
  const primaryPoolId = pools[0].id; // 'pool-bank'

  let activeBudgetId = null;

  if (v1Data && Array.isArray(v1Data.budgets)) {
    for (const b of v1Data.budgets) {
      const budgetId = b.id || Math.random().toString(36).slice(2, 9);
      if (b.id === v1Data.active || !activeBudgetId) {
        activeBudgetId = budgetId;
      }

      v2Budgets.push({
        id: budgetId,
        name: b.name || 'Daily Budget',
        kind: 'daily',
        amount: Number(b.amount) || 0,
        days: Number(b.days) || 30,
        start: b.start || new Date().toISOString().slice(0, 10),
        funding: [{ poolId: primaryPoolId, amount: Number(b.amount) || 0 }]
      });

      // Migrate historic expenses to ledger
      if (Array.isArray(b.expenses)) {
        for (const e of b.expenses) {
          ledgerEntries.push({
            id: e.id || Math.random().toString(36).slice(2, 9),
            date: e.date,
            type: 'expense',
            amount: Number(e.amt) || 0,
            note: e.note || '',
            poolId: primaryPoolId,
            budgetId: budgetId
          });
        }
      }
    }
  }

  // Include default envelopes
  for (const env of DEFAULT_ENVELOPES) {
    if (!v2Budgets.some((b) => b.id === env.id || b.name === env.name)) {
      v2Budgets.push({ ...env });
    }
  }

  const config = {
    version: 2,
    cycleStartDay: 1,
    activeTab: 'overview',
    activeBudgetId: activeBudgetId || v2Budgets[0]?.id || null,
    pools,
    budgets: v2Budgets,
    obligations: [],
    expectedIncomes: [],
    v1Migration: {
      migratedAt: new Date().toISOString(),
      backupKey: V1_BACKUP_KEY
    }
  };

  return { config, ledgerEntries, backupSaved: true };
}

/**
 * Migrates a v2 config + ledger into a v3 single records array
 */
export function migrateV2toV3(v2Config = {}, v2LedgerEntries = []) {
  const records = [];
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // 1. Config record
  records.push({
    id: 'config-system',
    ts: now,
    type: 'config',
    date: today,
    data: {
      cycleStartDay: v2Config.cycleStartDay || 1
    }
  });

  // 2. Pool records
  if (Array.isArray(v2Config.pools)) {
    for (const p of v2Config.pools) {
      records.push({
        id: p.id || ('pool-' + Math.random().toString(36).slice(2, 7)),
        ts: now,
        type: 'pool',
        date: today,
        data: {
          name: p.name || 'Unnamed Pool',
          poolType: p.type || 'bank',
          opening: Number(p.opening) || 0,
          isArchived: Boolean(p.isArchived)
        }
      });
    }
  }

  // 3. Budget records
  if (Array.isArray(v2Config.budgets)) {
    for (const b of v2Config.budgets) {
      records.push({
        id: b.id || ('budget-' + Math.random().toString(36).slice(2, 7)),
        ts: now,
        type: 'budget',
        date: b.start || today,
        data: {
          name: b.name || 'Budget',
          kind: b.kind || 'envelope',
          amount: Number(b.amount) || 0,
          days: Number(b.days) || 30,
          start: b.start || today,
          funding: Array.isArray(b.funding) ? [...b.funding] : [],
          hardCap: Boolean(b.hardCap),
          refillMonthly: Boolean(b.refillMonthly),
          refillAmount: Number(b.refillAmount) || 0
        }
      });
    }
  }

  // 4. Obligation records
  if (Array.isArray(v2Config.obligations)) {
    for (const o of v2Config.obligations) {
      records.push({
        id: o.id || ('ob-' + Math.random().toString(36).slice(2, 7)),
        ts: now,
        type: 'obligation',
        date: o.created || today,
        data: {
          role: o.role || 'bill',
          counterparty: o.counterparty || '',
          direction: o.direction || 'pay',
          principal: Number(o.principal) || 0,
          due: o.due || null,
          status: o.status || 'confirmed',
          likelihood: typeof o.likelihood === 'number' ? o.likelihood : 100,
          recurrence: o.recurrence || null,
          funding: Array.isArray(o.funding) ? [...o.funding] : [],
          note: o.note || ''
        }
      });
    }
  }

  // 5. Expected Incomes
  if (Array.isArray(v2Config.expectedIncomes)) {
    for (const inc of v2Config.expectedIncomes) {
      records.push({
        id: inc.id || ('inc-' + Math.random().toString(36).slice(2, 7)),
        ts: now,
        type: 'expected-income',
        date: inc.date || today,
        data: {
          source: inc.source || 'Income',
          amount: Number(inc.amount) || 0,
          recurrence: inc.recurrence || null,
          likelihood: typeof inc.likelihood === 'number' ? inc.likelihood : 100
        }
      });
    }
  }

  // 6. Ledger entries -> transaction records
  if (Array.isArray(v2LedgerEntries)) {
    for (const e of v2LedgerEntries) {
      const { id, date, type, ...rest } = e;
      const normType = type === 'loan_out' ? 'loan-out' : type === 'loan_in' ? 'loan-in' : type;
      records.push({
        id: id || ('tx-' + Math.random().toString(36).slice(2, 9)),
        ts: now,
        type: normType,
        date: date || today,
        data: rest
      });
    }
  }

  return records;
}
