import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCoreNumbers } from '../src/domain/totals.mjs';
import { projectAtDate } from '../src/domain/projection.mjs';

test('totals - exact verification of Section 6 worked example', () => {
  // Pools: Bank 10000 + Cash 1500 -> Total 11500
  const pools = [
    { id: 'bank', name: 'Bank', opening: 10000 },
    { id: 'cash', name: 'Cash', opening: 1500 }
  ];

  // Budgets: Food (4200 remaining), Petrol (1500 remaining), Impulse (500 remaining)
  const budgets = [
    {
      id: 'food',
      name: 'Food',
      kind: 'daily',
      amount: 4200,
      days: 30,
      start: '2026-11-01',
      funding: [{ poolId: 'bank', amount: 4200 }]
    },
    {
      id: 'petrol',
      name: 'Petrol',
      kind: 'envelope',
      funding: [{ poolId: 'bank', amount: 1500 }]
    },
    {
      id: 'impulse',
      name: 'Impulse',
      kind: 'envelope',
      funding: [{ poolId: 'cash', amount: 500 }],
      hardCap: true
    }
  ];

  // Rent 3000 due in horizon, funded 3000
  // Owe friend 800 (confirmed, due in horizon, unfunded)
  // Potential debt 400 (likelihood 50%)
  const obligations = [
    {
      id: 'rent',
      role: 'bill',
      counterparty: 'Landlord',
      direction: 'pay',
      principal: 3000,
      outstanding: 3000,
      due: '2026-11-30',
      status: 'confirmed',
      funding: [{ poolId: 'bank', amount: 3000 }]
    },
    {
      id: 'friend-debt',
      role: 'debt',
      counterparty: 'Friend',
      direction: 'pay',
      principal: 800,
      outstanding: 800,
      due: '2026-11-20',
      status: 'confirmed',
      funding: [] // unfunded!
    },
    {
      id: 'potential-debt',
      role: 'debt',
      counterparty: 'Colleague',
      direction: 'pay',
      principal: 400,
      outstanding: 400,
      due: '2026-11-25',
      status: 'potential',
      likelihood: 50,
      funding: []
    }
  ];

  const ledger = []; // Fresh cycle with opening balances

  const core = calculateCoreNumbers({
    pools,
    budgets,
    obligations,
    ledgerEntries: ledger,
    horizonDate: '2026-12-01',
    asOfDate: '2026-11-01'
  });

  // Verify core numbers:
  assert.equal(core.totalAvailable, 11500); // 10000 + 1500
  assert.equal(core.budgetsCommitted, 6200); // 4200 + 1500 + 500
  assert.equal(core.obligationsCommitted, 3000); // Rent funded 3000
  assert.equal(core.committed, 9200); // 6200 + 3000
  assert.equal(core.totalConfirmedShortfall, 800); // Friend debt 800 unfunded
  assert.equal(core.unallocated, 1500); // 11500 - 9200 - 800 = 1500!

  // Check Cap vs Pace projection at end of 30-day cycle:
  const proj = projectAtDate({
    targetDate: '2026-12-01',
    asOfDate: '2026-11-01',
    pools,
    budgets,
    obligations,
    ledgerEntries: ledger
  });

  // Potential debt 400 (likelihood 50%):
  // Cap subtracts 400 from Unallocated -> 1500 - 400 = 1100
  // Pace subtracts 200 from Unallocated -> 1500 - 200 = 1300
  // In terms of end-of-horizon bank balance:
  // Cap spent: 6200 (budgets) + 3000 (rent) + 800 (friend) + 400 (potential) = 10400 outflow -> Left = 11500 - 10400 = 1100!
  // Pace with 50% weight: 6200 + 3000 + 800 + 200 = 10200 outflow -> Left = 11500 - 10200 = 1300!
  assert.equal(proj.capProjected, 1100);
  assert.equal(proj.paceProjected, 1300);
});

test('totals - overspending beyond funded reduces Unallocated one-for-one (floor at 0)', () => {
  const pools = [{ id: 'bank', name: 'Bank', opening: 5000 }];
  const budgets = [
    {
      id: 'env',
      name: 'Shopping',
      kind: 'envelope',
      funding: [{ poolId: 'bank', amount: 1000 }]
    }
  ];

  // Initially: Total = 5000, Committed = 1000, Unallocated = 4000
  const initial = calculateCoreNumbers({ pools, budgets, obligations: [], ledgerEntries: [] });
  assert.equal(initial.unallocated, 4000);

  // Overspend 1200 from bank charged to env (200 beyond funded)
  const ledger = [
    { id: 'e1', date: '2026-11-01', type: 'expense', amount: 1200, poolId: 'bank', budgetId: 'env' }
  ];

  const after = calculateCoreNumbers({ pools, budgets, obligations: [], ledgerEntries: ledger });
  // Total available = 5000 - 1200 = 3800
  // Committed = max(0, 1000 - 1200) = 0
  // Unallocated = 3800 - 0 = 3800
  // Drop in Unallocated from 4000 to 3800 = 200 (exact one-for-one reduction!)
  assert.equal(after.totalAvailable, 3800);
  assert.equal(after.committed, 0);
  assert.equal(after.unallocated, 3800);
});

test('totals - direct pool spends deduct from pool and unallocated without touching budgets', () => {
  const pools = [{ id: 'bank', name: 'Bank Account', opening: 10000 }];
  const budgets = [
    {
      id: 'daily',
      name: 'Daily Food',
      kind: 'daily',
      amount: 6000,
      days: 30,
      start: '2026-11-01',
      funding: [{ poolId: 'bank', amount: 6000 }]
    }
  ];

  // Initial state: Total = 10,000, Daily Budget Committed = 6,000, Unallocated = 4,000
  const initial = calculateCoreNumbers({
    pools,
    budgets,
    obligations: [],
    ledgerEntries: [],
    asOfDate: '2026-11-01'
  });
  assert.equal(initial.totalAvailable, 10000);
  assert.equal(initial.committed, 6000);
  assert.equal(initial.unallocated, 4000);

  // Direct spend of 1,500 from Bank (e.g. rare laptop repair, no budgetId)
  const ledger = [
    {
      id: 'e-direct-1',
      date: '2026-11-01',
      type: 'expense',
      amount: 1500,
      poolId: 'bank',
      budgetId: null,
      note: 'Laptop repair'
    }
  ];

  const afterDirect = calculateCoreNumbers({
    pools,
    budgets,
    obligations: [],
    ledgerEntries: ledger,
    asOfDate: '2026-11-01'
  });

  // 1. Bank balance reduced by 1,500 -> 8,500
  assert.equal(afterDirect.totalAvailable, 8500);
  assert.equal(afterDirect.poolBalances.find((p) => p.id === 'bank').balance, 8500);

  // 2. Budget committed is UNCHANGED -> 6,000
  assert.equal(afterDirect.committed, 6000);
  assert.equal(afterDirect.budgetDetails[0].fundedRemaining, 6000);
  assert.equal(afterDirect.budgetDetails[0].state.spent, 0);
  assert.equal(afterDirect.budgetDetails[0].state.currentAllowance, 200); // 6000 / 30 intact!

  // 3. Unallocated cash reduced by exactly 1,500 -> 2,500
  assert.equal(afterDirect.unallocated, 2500);
});
