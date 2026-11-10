import { dayDiff, addDays, todayISO, parseISO, formatDate } from './dateUtils.mjs';
import { calculateCoreNumbers } from './totals.mjs';
import { getOccurrencesUpTo } from './recurrence.mjs';
import { calcDailyBudget, calcEnvelope } from './budgets.mjs';
import { calculateObligationState } from './obligations.mjs';

/**
 * Projects financial trajectory and balances at any target future date H.
 * Generates both Cap (conservative worst-case floor) and Pace (expected velocity).
 * Also outputs a day-by-day curve for SVG charting and an itemized event list.
 */
export function projectAtDate({
  targetDate,
  asOfDate = todayISO(),
  pools = [],
  budgets = [],
  obligations = [],
  ledgerEntries = [],
  expectedIncomes = []
}) {
  const core = calculateCoreNumbers({
    pools,
    budgets,
    obligations,
    ledgerEntries,
    horizonDate: targetDate,
    asOfDate
  });

  const daysToTarget = Math.max(0, dayDiff(asOfDate, targetDate));
  const events = [];

  // 1. Process Obligations & Recurring Bills
  let capBillOutflow = 0;
  let paceBillOutflow = 0;

  for (const rawOb of obligations) {
    const ob = calculateObligationState(rawOb, ledgerEntries);
    if (ob.isClosed) continue;

    if (ob.recurrence) {
      // Find all recurring occurrences between asOfDate and targetDate
      const occurrences = getOccurrencesUpTo(ob.recurrence, targetDate, asOfDate);
      for (const occDate of occurrences) {
        const isPotential = ob.status === 'potential';
        const weight = isPotential ? ((ob.likelihood || 50) / 100) : 1.0;
        const amt = ob.principal;

        events.push({
          date: occDate,
          type: ob.role === 'bill' ? 'bill' : 'debt',
          name: ob.counterparty || 'Bill',
          amount: amt,
          direction: 'out',
          isPotential,
          likelihood: ob.likelihood || 100
        });

        capBillOutflow += amt;
        paceBillOutflow += amt * weight;
      }
    } else if (!ob.ignoreDueDate && ob.due && ob.due >= asOfDate && ob.due <= targetDate) {
      const isPotential = ob.status === 'potential';
      const weight = isPotential ? ((ob.likelihood || 50) / 100) : 1.0;
      const amt = ob.outstanding;

      if (ob.direction === 'pay' || ob.role === 'bill') {
        events.push({
          date: ob.due,
          type: ob.role === 'bill' ? 'bill' : 'debt',
          name: ob.counterparty || 'Payable',
          amount: amt,
          direction: 'out',
          isPotential,
          likelihood: ob.likelihood || 100
        });

        capBillOutflow += amt;
        paceBillOutflow += amt * weight;
      } else if (ob.direction === 'receive') {
        events.push({
          date: ob.due,
          type: 'receivable',
          name: ob.counterparty || 'Receivable',
          amount: amt,
          direction: 'in',
          isPotential,
          likelihood: ob.likelihood || 100
        });

        // Cap excludes receivables (not received yet); Pace includes them
        if (!isPotential) {
          paceBillOutflow -= amt * weight; // Negative outflow = inflow
        }
      }
    }
  }

  // 2. Expected Incomes
  let paceIncomeInflow = 0;
  for (const inc of expectedIncomes) {
    const occurrences = inc.recurrence
      ? getOccurrencesUpTo(inc.recurrence, targetDate, asOfDate)
      : (inc.date && inc.date >= asOfDate && inc.date <= targetDate ? [inc.date] : []);

    for (const occDate of occurrences) {
      const amt = Number(inc.amount) || 0;
      const weight = ((inc.likelihood ?? 100) / 100);

      events.push({
        date: occDate,
        type: 'income',
        name: inc.source || 'Expected Income',
        amount: amt,
        direction: 'in',
        likelihood: inc.likelihood ?? 100
      });

      paceIncomeInflow += amt * weight;
    }
  }

  // 3. Budgets Burn Estimation
  let capBudgetOutflow = 0;
  let paceBudgetOutflow = 0;

  for (const b of budgets) {
    if (b.kind === 'daily') {
      const d = calcDailyBudget(b, ledgerEntries, asOfDate);
      const remaining = Math.max(0, d.left);
      capBudgetOutflow += remaining;

      // In pace mode, estimate daily burn up to daysToTarget
      const dailyVelocity = d.burnRateDaily > 0 ? d.burnRateDaily : d.basePerDay;
      const projectedBurn = Math.min(remaining, dailyVelocity * daysToTarget);
      paceBudgetOutflow += projectedBurn;
    } else {
      const env = calcEnvelope(b, ledgerEntries);
      capBudgetOutflow += env.fundedRemaining;

      // For envelopes, assume proportional burn over daysToTarget relative to a 30-day cycle
      const dailyVelocity = env.funded / 30;
      const projectedBurn = Math.min(env.fundedRemaining, dailyVelocity * daysToTarget);
      paceBudgetOutflow += projectedBurn;
    }
  }

  // Cap: Total available - full budget spend - all confirmed and potential bills/payables
  const capProjected = core.totalAvailable - capBudgetOutflow - capBillOutflow;

  // Pace: Total available + expected inflows - pace budget burn - pace bills/payables
  const paceProjected = core.totalAvailable + paceIncomeInflow - paceBudgetOutflow - paceBillOutflow;

  // Sort events chronologically
  events.sort((a, b) => a.date.localeCompare(b.date));

  // 4. Generate Day-by-Day Trajectory Curve for SVG Charting
  const trajectory = [];
  const maxDays = Math.min(daysToTarget, 120); // Cap chart trajectory at 120 days
  let runningPace = core.totalAvailable;
  let runningCap = core.totalAvailable;
  // Worst-Case Floor: 100% of all envelope and budget allocations considered ALREADY SPENT on Day 0
  let runningWorstCase = core.totalAvailable - capBudgetOutflow;

  const dailyCapBurn = maxDays > 0 ? capBudgetOutflow / maxDays : 0;
  const dailyPaceBurn = maxDays > 0 ? paceBudgetOutflow / maxDays : 0;

  for (let i = 0; i <= maxDays; i++) {
    const curDate = addDays(asOfDate, i);
    const dayEvents = events.filter((e) => e.date === curDate);

    for (const ev of dayEvents) {
      if (ev.direction === 'in') {
        runningPace += ev.amount * ((ev.likelihood ?? 100) / 100);
      } else {
        runningCap -= ev.amount;
        runningPace -= ev.amount * ((ev.likelihood ?? 100) / 100);
        runningWorstCase -= ev.amount; // Deduct scheduled bills & debts
      }
    }

    if (i > 0) {
      runningCap -= dailyCapBurn;
      runningPace -= dailyPaceBurn;
    }

    trajectory.push({
      date: curDate,
      dayIndex: i,
      cap: Math.round(runningCap),
      pace: Math.round(runningPace),
      worstCase: Math.round(runningWorstCase),
      events: dayEvents
    });
  }

  return {
    targetDate,
    asOfDate,
    daysToTarget,
    totalAvailable: core.totalAvailable,
    unallocated: core.unallocated,
    capProjected: Math.round(capProjected),
    paceProjected: Math.round(paceProjected),
    worstCaseProjected: Math.round(capProjected),
    capBudgetOutflow,
    paceBudgetOutflow,
    capBillOutflow,
    paceBillOutflow,
    paceIncomeInflow,
    events,
    trajectory
  };
}
