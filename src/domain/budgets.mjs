import { dayNumber, addDays, todayISO } from './dateUtils.mjs';
import { aggregateBudgetSpends, aggregateAllocations } from './ledger.mjs';

/**
 * Calculates rolling daily allowance for a 'daily' budget.
 * Exact v1 parity:
 * allowance_i = (B − spent_before_i) / (N − i)
 * left_i = allowance_i − spent_i
 *
 * @param {Object} b - Daily budget object
 * @param {Array} ledgerEntries - All ledger entries
 * @param {string} asOfDate - Target date (defaults to todayISO())
 */
export function calcDailyBudget(b, ledgerEntries = [], asOfDate = todayISO()) {
  const N = Math.max(1, Math.floor(Number(b.days) || 30));
  const B = Number(b.amount) || 0;
  const s0 = dayNumber(b.start);
  const currentDayNum = dayNumber(asOfDate);
  const idx = currentDayNum - s0;

  const state = idx < 0 ? 'pre' : idx >= N ? 'done' : 'on';
  const di = Math.min(Math.max(idx, 0), N - 1);

  // Filter expenses belonging to this budget
  const expenses = ledgerEntries.filter(
    (e) => e.type === 'expense' && e.budgetId === b.id
  );

  const sp = Array(N).fill(0);
  for (const e of expenses) {
    const dayOffset = dayNumber(e.date) - s0;
    const clampedIndex = Math.min(Math.max(dayOffset, 0), N - 1);
    sp[clampedIndex] += Number(e.amount) || 0;
  }

  let cum = 0;
  const rows = [];
  for (let i = 0; i < N; i++) {
    const al = (B - cum) / (N - i);
    rows.push({
      i,
      date: addDays(b.start, i),
      al,
      sp: sp[i],
      left: al - sp[i]
    });
    cum += sp[i];
  }

  const currentRow = rows[di] || { al: B / N, sp: 0, left: B / N };
  const tomorrowRow = (state !== 'done' && di < N - 1) ? rows[di + 1] : null;
  const daysLeft = state === 'pre' ? N : state === 'done' ? 0 : N - di;

  return {
    N,
    B,
    state,
    di,
    rows,
    spent: cum,
    left: B - cum,
    currentAllowance: currentRow.al,
    spentToday: currentRow.sp,
    leftToday: state === 'done' ? B - cum : currentRow.left,
    tomorrowAllowance: tomorrowRow ? tomorrowRow.al : null,
    daysLeft,
    basePerDay: B / N,
    burnRateDaily: di > 0 ? cum / di : currentRow.sp
  };
}

/**
 * Computes envelope state: funded, spent, left, and hard cap status
 */
export function calcEnvelope(envelope, ledgerEntries = []) {
  const staticFunding = (envelope.funding || []).reduce(
    (sum, f) => sum + (Number(f.amount) || 0),
    0
  );
  const ledgerAlloc = aggregateAllocations(ledgerEntries).get(envelope.id) || 0;
  const totalFunded = staticFunding + ledgerAlloc;

  const spendMap = aggregateBudgetSpends(ledgerEntries);
  const spent = spendMap.get(envelope.id) || 0;

  const left = totalFunded - spent;
  const fundedRemaining = Math.max(0, left);
  const isOverspent = left < 0;
  const pctSpent = totalFunded > 0 ? Math.min(100, Math.round((spent / totalFunded) * 100)) : (spent > 0 ? 100 : 0);

  return {
    id: envelope.id,
    name: envelope.name,
    kind: 'envelope',
    funded: totalFunded,
    spent,
    left,
    fundedRemaining,
    isOverspent,
    pctSpent,
    hardCap: Boolean(envelope.hardCap),
    refillMonthly: Boolean(envelope.refillMonthly),
    refillAmount: Number(envelope.refillAmount) || 0
  };
}

/**
 * Validates whether an expense can be added to a budget.
 * Blocks addition only if envelope has hardCap = true and expense exceeds remaining balance.
 */
export function validateExpenseAdd(budget, amount, ledgerEntries = []) {
  const amt = Number(amount) || 0;
  if (amt <= 0) {
    return { allowed: false, reason: 'Expense amount must be greater than zero.' };
  }

  if (budget.kind === 'envelope' && budget.hardCap) {
    const envState = calcEnvelope(budget, ledgerEntries);
    if (envState.left - amt < 0) {
      return {
        allowed: false,
        reason: `Hard cap reached for "${budget.name}". Available: ₹${Math.max(0, envState.left).toFixed(2)}, Requested: ₹${amt.toFixed(2)}.`
      };
    }
  }

  return { allowed: true };
}
