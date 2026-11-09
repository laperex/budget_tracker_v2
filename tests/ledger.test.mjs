import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePoolBalances } from '../src/domain/ledger.mjs';

test('ledger - multi-pool balance derivation from 8 transaction types', () => {
  const pools = [
    { id: 'bank', name: 'Bank', opening: 1000 },
    { id: 'cash', name: 'Cash', opening: 200 }
  ];

  const ledger = [
    // Income into bank: +5000 -> bank = 6000
    { id: '1', date: '2026-11-01', type: 'income', poolId: 'bank', amount: 5000 },
    // Spend from cash: -50 -> cash = 150
    { id: '2', date: '2026-11-02', type: 'expense', poolId: 'cash', amount: 50 },
    // Transfer bank -> cash: 300 -> bank = 5700, cash = 450
    { id: '3', date: '2026-11-03', type: 'transfer', poolId: 'bank', toPoolId: 'cash', amount: 300 },
    // Loan in to bank (debt created): +1000 -> bank = 6700
    { id: '4', date: '2026-11-04', type: 'loan_in', poolId: 'bank', amount: 1000 },
    // Loan out from cash (receivable created): -100 -> cash = 350
    { id: '5', date: '2026-11-05', type: 'loan_out', poolId: 'cash', amount: 100 },
    // Repayment out from bank (paying back debt): -500 -> bank = 6200
    { id: '6', date: '2026-11-06', type: 'repayment', poolId: 'bank', direction: 'out', amount: 500 },
    // Repayment in to cash (friend repaying): +50 -> cash = 400
    { id: '7', date: '2026-11-07', type: 'repayment', poolId: 'cash', direction: 'in', amount: 50 },
    // Reconcile adjustment to cash: target 380 -> cash = 380
    { id: '8', date: '2026-11-08', type: 'adjustment', poolId: 'cash', targetBalance: 380 }
  ];

  const balances = calculatePoolBalances(pools, ledger);
  assert.equal(balances.get('bank').balance, 6200);
  assert.equal(balances.get('cash').balance, 380);
});
