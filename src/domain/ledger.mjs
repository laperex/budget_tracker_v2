/**
 * Pure ledger calculation engine.
 * Derives pool balances, budget spends, and obligation settlements directly from append-only events.
 */

/**
 * Calculates current balance for all pools based on opening balances + ledger events.
 *
 * balance = opening + Σ income + Σ loan_in − Σ spend − Σ repayment_out − Σ loan_out ± Σ transfer ± Σ adjustment
 *
 * @param {Array} pools
 * @param {Array} ledgerEntries
 * @returns {Map<string, { id: string, name: string, type: string, balance: number, opening: number, isArchived: boolean }>}
 */
export function calculatePoolBalances(pools, ledgerEntries = []) {
  const map = new Map();
  for (const p of pools) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      type: p.type || 'bank',
      opening: Number(p.opening) || 0,
      balance: Number(p.opening) || 0,
      isArchived: Boolean(p.isArchived)
    });
  }

  // Sort entries chronologically to ensure adjustments set state accurately in time order
  const sorted = [...ledgerEntries].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.id || '').localeCompare(b.id || '');
  });

  for (const entry of sorted) {
    const amt = Number(entry.amount) || 0;
    const pool = map.get(entry.poolId);

    switch (entry.type) {
      case 'income':
      case 'loan_in': {
        if (pool) pool.balance += amt;
        break;
      }

      case 'expense':
      case 'loan_out': {
        if (pool) pool.balance -= amt;
        break;
      }

      case 'transfer': {
        const fromPool = map.get(entry.poolId);
        const toPool = map.get(entry.toPoolId);
        if (fromPool) fromPool.balance -= amt;
        if (toPool) toPool.balance += amt;
        break;
      }

      case 'repayment': {
        if (pool) {
          // If direction === 'in' (someone repaid me), money enters pool
          // If direction === 'out' (I repaid debt), money leaves pool
          if (entry.direction === 'in') {
            pool.balance += amt;
          } else {
            pool.balance -= amt;
          }
        }
        break;
      }

      case 'adjustment': {
        if (pool) {
          if (typeof entry.targetBalance === 'number') {
            pool.balance = entry.targetBalance;
          } else if (typeof entry.delta === 'number') {
            pool.balance += entry.delta;
          }
        }
        break;
      }

      case 'allocation':
        // Allocation adjusts budget earmarks, no physical pool balance change
        break;

      default:
        break;
    }
  }

  return map;
}

/**
 * Returns map of budgetId -> total spend
 */
export function aggregateBudgetSpends(ledgerEntries = []) {
  const spendMap = new Map();
  for (const entry of ledgerEntries) {
    if (entry.type === 'expense' && entry.budgetId) {
      const prev = spendMap.get(entry.budgetId) || 0;
      spendMap.set(entry.budgetId, prev + (Number(entry.amount) || 0));
    }
  }
  return spendMap;
}

/**
 * Returns map of obligationId -> total repayments & expenses
 */
export function aggregateObligationPayments(ledgerEntries = []) {
  const map = new Map();
  for (const entry of ledgerEntries) {
    const amt = Number(entry.amount) || 0;
    if (entry.type === 'repayment' && entry.obligationId) {
      const prev = map.get(entry.obligationId) || 0;
      map.set(entry.obligationId, prev + amt);
    } else if (entry.type === 'expense' && entry.obligationId) {
      // Bill payment entered as expense charged to obligation
      const prev = map.get(entry.obligationId) || 0;
      map.set(entry.obligationId, prev + amt);
    }
  }
  return map;
}

/**
 * Computes net funding allocated to a budget from allocations
 */
export function aggregateAllocations(ledgerEntries = []) {
  const budgetAllocations = new Map();
  for (const entry of ledgerEntries) {
    if (entry.type === 'allocation') {
      const amt = Number(entry.amount) || 0;
      if (entry.toBudgetId) {
        const cur = budgetAllocations.get(entry.toBudgetId) || 0;
        budgetAllocations.set(entry.toBudgetId, cur + amt);
      }
      if (entry.fromBudgetId) {
        const cur = budgetAllocations.get(entry.fromBudgetId) || 0;
        budgetAllocations.set(entry.fromBudgetId, cur - amt);
      }
    }
  }
  return budgetAllocations;
}
