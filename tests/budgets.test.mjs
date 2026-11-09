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
