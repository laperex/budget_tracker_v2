import test from 'node:test';
import assert from 'node:assert/strict';
import { calcDailyBudget, calcEnvelope, validateExpenseAdd } from '../src/domain/budgets.mjs';

test('budgets - daily rolling allowance calculation (v1 parity)', () => {
  const budget = {
    id: 'b1',
    name: 'Food',
    amount: 6000,
    days: 30,
    start: '2026-11-01'
  };

  // Day 1 (index 0), no expenses yet
  const d0 = calcDailyBudget(budget, [], '2026-11-01');
  assert.equal(d0.currentAllowance, 200); // 6000 / 30
  assert.equal(d0.leftToday, 200);
  assert.equal(d0.daysLeft, 30);

  // Spend 100 on Day 1 (underspend by 100)
  const ledger = [
    { id: 'e1', date: '2026-11-01', type: 'expense', amount: 100, budgetId: 'b1' }
  ];

  // Inspect Day 2: remaining budget 5900 over 29 days = ~203.45/day (raises later days!)
  const d1 = calcDailyBudget(budget, ledger, '2026-11-02');
  const expectedDay2Allowance = (6000 - 100) / 29;
  assert.ok(Math.abs(d1.currentAllowance - expectedDay2Allowance) < 0.01);
  assert.ok(d1.currentAllowance > 200); // Underspend raised allowance!

  // Overspend 500 on Day 2
  ledger.push({ id: 'e2', date: '2026-11-02', type: 'expense', amount: 500, budgetId: 'b1' });
  const d2 = calcDailyBudget(budget, ledger, '2026-11-03');
  const expectedDay3Allowance = (6000 - 600) / 28;
  assert.ok(Math.abs(d2.currentAllowance - expectedDay3Allowance) < 0.01);
  assert.ok(d2.currentAllowance < 200); // Overspend lowered allowance!
});

test('budgets - envelope funding and hard-cap enforcement', () => {
  const impulse = {
    id: 'env-impulse',
    name: 'Impulse',
    kind: 'envelope',
    funding: [{ poolId: 'pool-bank', amount: 500 }],
    hardCap: true
  };

  const ledger = [
    { id: 'e1', date: '2026-11-02', type: 'expense', amount: 450, budgetId: 'env-impulse' }
  ];

  const env = calcEnvelope(impulse, ledger);
  assert.equal(env.funded, 500);
  assert.equal(env.spent, 450);
  assert.equal(env.left, 50);

  // Spending 40 should be allowed
  assert.equal(validateExpenseAdd(impulse, 40, ledger).allowed, true);

  // Spending 60 exceeds the remaining 50 -> must be blocked!
  const blockedCheck = validateExpenseAdd(impulse, 60, ledger);
  assert.equal(blockedCheck.allowed, false);
  assert.match(blockedCheck.reason, /Hard cap reached/);
});

test('budgets - arbitrary date range (start -> endDate) and state boundaries', () => {
  // A 10-day trip from 2026-11-10 to 2026-11-19 with ₹10,000 budget
  const tripBudget = {
    id: 'b-trip',
    name: 'Goa Trip',
    amount: 10000,
    start: '2026-11-10',
    endDate: '2026-11-19'
  };

  // 1. Before start date (state: 'pre')
  const pre = calcDailyBudget(tripBudget, [], '2026-11-08');
  assert.equal(pre.N, 10);
  assert.equal(pre.state, 'pre');
  assert.equal(pre.daysLeft, 10);
  assert.equal(pre.currentAllowance, 1000); // Base pace 10000 / 10

  // 2. Day 1 of the trip (index 0)
  const d0 = calcDailyBudget(tripBudget, [], '2026-11-10');
  assert.equal(d0.state, 'on');
  assert.equal(d0.di, 0);
  assert.equal(d0.daysLeft, 10);
  assert.equal(d0.currentAllowance, 1000);
  assert.equal(d0.leftToday, 1000);

  // Spend 1500 on Day 1 (overspent by 500)
  const ledger = [
    { id: 't1', date: '2026-11-10', type: 'expense', amount: 1500, budgetId: 'b-trip' }
  ];

  // 3. Day 2 of the trip (index 1): 8500 remaining over 9 days = 944.44/day
  const d1 = calcDailyBudget(tripBudget, ledger, '2026-11-11');
  assert.equal(d1.state, 'on');
  assert.equal(d1.di, 1);
  assert.equal(d1.daysLeft, 9);
  assert.ok(Math.abs(d1.currentAllowance - (8500 / 9)) < 0.01);
  assert.equal(d1.spent, 1500);
  assert.equal(d1.left, 8500);

  // 4. Last day of trip: 2026-11-19 (index 9)
  const dLast = calcDailyBudget(tripBudget, ledger, '2026-11-19');
  assert.equal(dLast.state, 'on');
  assert.equal(dLast.di, 9);
  assert.equal(dLast.daysLeft, 1);

  // 5. After trip ends: 2026-11-20 (state: 'done')
  const done = calcDailyBudget(tripBudget, ledger, '2026-11-20');
  assert.equal(done.state, 'done');
  assert.equal(done.daysLeft, 0);
  assert.equal(done.left, 8500);
});

test('budgets - backward compatibility when only days is specified', () => {
  const legacyBudget = {
    id: 'b-leg',
    name: 'Legacy 15 Days',
    amount: 4500,
    start: '2026-11-01',
    days: 15
  };

  const calc = calcDailyBudget(legacyBudget, [], '2026-11-01');
  assert.equal(calc.N, 15);
  assert.equal(calc.endDate, '2026-11-15');
  assert.equal(calc.currentAllowance, 300);
});
