import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generatePythonAuditScript, runInvariantsCheck } from '../src/domain/audit.mjs';

test('audit - in-app invariants validator passes healthy state', () => {
  const state = {
    pools: [
      { id: 'bank', name: 'Bank', opening: 10000 },
      { id: 'cash', name: 'Cash', opening: 1500 }
    ],
    budgets: [
      { id: 'food', name: 'Food', kind: 'daily', amount: 6000, days: 30, start: '2026-11-01', funding: [{ poolId: 'bank', amount: 6000 }] }
    ],
    obligations: []
  };

  const ledger = [
    { id: 't1', date: '2026-11-02', type: 'transfer', poolId: 'bank', toPoolId: 'cash', amount: 500 }
  ];

  const check = runInvariantsCheck(state, ledger);
  assert.equal(check.passed, true);
  for (const c of check.checks) {
    assert.notEqual(c.status, 'fail');
  }
});

test('audit - Python audit script executes and verifies 100% parity with zero discrepancies', () => {
  const state = {
    cycleStartDay: 1,
    pools: [
      { id: 'bank', name: 'HDFC Bank', opening: 15000, isArchived: false },
      { id: 'cash', name: 'Physical Cash', opening: 2500, isArchived: false }
    ],
    budgets: [
      {
        id: 'daily-food',
        name: 'Daily Food',
        kind: 'daily',
        amount: 6000,
        days: 30,
        start: '2026-11-01',
        funding: [{ poolId: 'bank', amount: 6000 }]
      },
      {
        id: 'env-petrol',
        name: 'Petrol',
        kind: 'envelope',
        funding: [{ poolId: 'bank', amount: 2000 }],
        hardCap: false
      }
    ],
    obligations: [
      {
        id: 'rent',
        role: 'bill',
        counterparty: 'Landlord',
        direction: 'pay',
        principal: 5000,
        outstanding: 5000,
        due: '2026-11-30',
        status: 'confirmed',
        funding: [{ poolId: 'bank', amount: 5000 }]
      },
      {
        id: 'loan-bob',
        role: 'debt',
        counterparty: 'Bob',
        direction: 'pay',
        principal: 1000,
        outstanding: 1000,
        due: '2026-11-20',
        status: 'confirmed',
        funding: [] // unfunded
      }
    ],
    expectedIncomes: []
  };

  const ledger = [
    { id: 'e1', date: '2026-11-02', type: 'expense', poolId: 'bank', budgetId: 'daily-food', amount: 450, note: 'Groceries' },
    { id: 'e2', date: '2026-11-03', type: 'expense', poolId: 'bank', budgetId: 'env-petrol', amount: 800, note: 'Fuel' },
    { id: 't1', date: '2026-11-04', type: 'transfer', poolId: 'bank', toPoolId: 'cash', amount: 1000, note: 'ATM Withdrawal' }
  ];

  // Generate python verification script
  const pyCode = generatePythonAuditScript(state, ledger, '2026-11-30');
  const tempScriptPath = path.join('/tmp', `verify_test_${Date.now()}.py`);
  fs.writeFileSync(tempScriptPath, pyCode, 'utf8');

  try {
    const stdout = execFileSync('python3', [tempScriptPath], { encoding: 'utf8' });
    console.log(stdout);

    assert.match(stdout, /100% MATHEMATICAL PARITY/);
    assert.match(stdout, /0 DISCREPANCIES/);
  } finally {
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }
  }
});
