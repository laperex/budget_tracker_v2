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
