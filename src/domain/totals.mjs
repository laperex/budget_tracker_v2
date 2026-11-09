import { calculatePoolBalances } from './ledger.mjs';
import { calcDailyBudget, calcEnvelope } from './budgets.mjs';
import { calculateObligationState } from './obligations.mjs';
import { todayISO } from './dateUtils.mjs';

/**
 * Calculates core financial numbers according to Section 5:
 * Total available, Committed, Shortfalls, Unallocated, and Net Position.
 *
 * @param {Object} params
 * @param {Array} params.pools
 * @param {Array} params.budgets
 * @param {Array} params.obligations
 * @param {Array} params.ledgerEntries
 * @param {string} [params.horizonDate] - Cutoff date for due obligations (defaults to null = all due obligations)
 * @param {string} [params.asOfDate] - Current date reference
 */
export function calculateCoreNumbers({
  pools = [],
  budgets = [],
  obligations = [],
  ledgerEntries = [],
  horizonDate = null,
  asOfDate = todayISO()
}) {
  const poolBalancesMap = calculatePoolBalances(pools, ledgerEntries);
  
  // Total available = Σ pool balances (non-archived)
  let totalAvailable = 0;
  for (const pool of poolBalancesMap.values()) {
    if (!pool.isArchived) {
      totalAvailable += pool.balance;
    }
  }

  // 1. Calculate funded remaining for budgets
  let budgetsCommitted = 0;
  const budgetDetails = [];

  for (const b of budgets) {
    if (b.kind === 'daily') {
      const dailyState = calcDailyBudget(b, ledgerEntries, asOfDate);
      // Funded remaining is total left in budget, floored at 0
      const remaining = Math.max(0, dailyState.left);
      budgetsCommitted += remaining;
      budgetDetails.push({ id: b.id, name: b.name, kind: 'daily', fundedRemaining: remaining, state: dailyState });
    } else {
      const envState = calcEnvelope(b, ledgerEntries);
      budgetsCommitted += envState.fundedRemaining;
      budgetDetails.push({ id: b.id, name: b.name, kind: 'envelope', fundedRemaining: envState.fundedRemaining, state: envState });
    }
  }

  // 2. Calculate obligations committed and shortfalls
  let obligationsCommitted = 0;
  let totalConfirmedShortfall = 0;
  let potentialDebtTotal = 0;
  let potentialDebtWeighted = 0;
  let confirmedReceivablesTotal = 0;
  let confirmedPayablesTotal = 0;

  const obligationDetails = [];

  for (const ob of obligations) {
    const state = calculateObligationState(ob, ledgerEntries);
    obligationDetails.push(state);

    if (state.isClosed) continue;

    // Obligations may have funded envelopes/allocations assigned to them
    obligationsCommitted += state.fundedRemaining;

    const isDueInHorizon = !state.ignoreDueDate && (!horizonDate || !state.due || state.due <= horizonDate);

    if (state.direction === 'pay') {
      if (state.status === 'confirmed' || state.status === 'partial') {
        confirmedPayablesTotal += state.outstanding;
        if (isDueInHorizon) {
          const shortfall = Math.max(0, state.outstanding - state.fundedRemaining);
          totalConfirmedShortfall += shortfall;
        }
      } else if (state.status === 'potential') {
        if (isDueInHorizon) {
          potentialDebtTotal += state.outstanding;
          potentialDebtWeighted += state.outstanding * ((state.likelihood || 50) / 100);
        }
      }
    } else if (state.direction === 'receive') {
      if (state.status === 'confirmed' || state.status === 'partial') {
        confirmedReceivablesTotal += state.outstanding;
      }
    }
  }

  const committed = budgetsCommitted + obligationsCommitted;
  const unallocated = totalAvailable - committed - totalConfirmedShortfall;
  const netPosition = totalAvailable + confirmedReceivablesTotal - confirmedPayablesTotal;

  return {
    totalAvailable,
    budgetsCommitted,
    obligationsCommitted,
    committed,
    totalConfirmedShortfall,
    unallocated,
    netPosition,
    potentialDebtTotal,
    potentialDebtWeighted,
    confirmedReceivablesTotal,
    confirmedPayablesTotal,
    poolBalances: Array.from(poolBalancesMap.values()),
    budgetDetails,
    obligationDetails
  };
}
