/**
 * Derivation Engine: Pure functional pipeline.
 * Takes a flat array of records and derives the complete system state.
 * All queries, summaries, balances, and analytics are functions over this state.
 */

import { todayISO, dayDiff, addDays } from './dateUtils.mjs';
import { calculatePoolBalances, aggregateBudgetSpends, aggregateObligationPayments, aggregateAllocations } from './ledger.mjs';
import { calculateCoreNumbers } from './totals.mjs';
import { projectAtDate } from './projection.mjs';

export function deriveState(records = [], asOfDate = todayISO()) {
  const config = {
    cycleStartDay: 1
  };
  const pools = [];
  const budgets = [];
  const obligations = [];
  const expectedIncomes = [];
  const transactions = [];

  for (const r of records) {
    if (!r || !r.type) continue;
    const type = r.type;
    const data = r.data || {};

    switch (type) {
      case 'config': {
        if (data.cycleStartDay) config.cycleStartDay = Number(data.cycleStartDay) || 1;
        break;
      }

      case 'pool': {
        pools.push({
          id: r.id,
          name: data.name || 'Unnamed Pool',
          type: data.poolType || data.type || 'bank',
          opening: Number(data.opening) || 0,
          isArchived: Boolean(data.isArchived)
        });
        break;
      }

      case 'budget': {
        const start = data.start || r.date || asOfDate;
        const endDate = data.endDate || data.end || null;
        let days = Number(data.days);
        if (endDate && start) {
          days = Math.max(1, dayDiff(start, endDate) + 1);
        } else if (!days || isNaN(days)) {
          days = 30;
        }

        budgets.push({
          id: r.id,
          name: data.name || 'Unnamed Budget',
          kind: data.kind || 'envelope',
          amount: Number(data.amount) || 0,
          days,
          start,
          endDate: endDate || addDays(start, days - 1),
          funding: Array.isArray(data.funding) ? [...data.funding] : [],
          hardCap: Boolean(data.hardCap),
          refillMonthly: Boolean(data.refillMonthly),
          refillAmount: Number(data.refillAmount) || 0
        });
        break;
      }

      case 'obligation': {
        obligations.push({
          id: r.id,
          role: data.role || 'bill',
          counterparty: data.counterparty || '',
          direction: data.direction || 'pay',
          principal: Number(data.principal) || 0,
          due: data.due || null,
          ignoreDueDate: Boolean(data.ignoreDueDate),
          status: data.status || 'confirmed',
          likelihood: typeof data.likelihood === 'number' ? data.likelihood : 100,
          recurrence: data.recurrence || null,
          funding: Array.isArray(data.funding) ? [...data.funding] : [],
          note: data.note || ''
        });
        break;
      }

      case 'expected-income': {
        expectedIncomes.push({
          id: r.id,
          source: data.source || 'Income',
          amount: Number(data.amount) || 0,
          date: r.date || asOfDate,
          recurrence: data.recurrence || null,
          likelihood: typeof data.likelihood === 'number' ? data.likelihood : 100
        });
        break;
      }

      // Transaction records
      case 'expense':
      case 'income':
      case 'transfer':
      case 'loan-out':
      case 'loan_out':
      case 'loan-in':
      case 'loan_in':
      case 'repayment':
      case 'adjustment':
      case 'allocation': {
        const normType = type === 'loan_out' ? 'loan-out' : type === 'loan_in' ? 'loan-in' : type;
        transactions.push({
          id: r.id,
          ts: r.ts,
          date: r.date || asOfDate,
          type: normType,
          ...data
        });
        break;
      }

      default:
        break;
    }
  }

  // Sort transactions chronologically
  transactions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.id || '').localeCompare(b.id || '');
  });

  return {
    config,
    pools,
    budgets,
    obligations,
    expectedIncomes,
    transactions
  };
}

/**
 * Computes the complete derived financial dashboard snapshot directly from the raw records.
 */
export function computeDashboardFromRecords(records = [], options = {}) {
  const asOfDate = options.asOfDate || todayISO();
  const horizonDate = options.horizonDate || null;

  const derived = deriveState(records, asOfDate);

  const coreNumbers = calculateCoreNumbers({
    pools: derived.pools,
    budgets: derived.budgets,
    obligations: derived.obligations,
    ledgerEntries: derived.transactions,
    horizonDate,
    asOfDate
  });

  const projection = projectAtDate({
    pools: derived.pools,
    budgets: derived.budgets,
    obligations: derived.obligations,
    expectedIncomes: derived.expectedIncomes,
    ledgerEntries: derived.transactions,
    targetDate: horizonDate || asOfDate,
    asOfDate
  });

  return {
    ...derived,
    coreNumbers,
    projection,
    asOfDate,
    horizonDate
  };
}
