import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAtDate } from '../src/domain/projection.mjs';

test('projection - arbitrary future dates (Dec 23 vs Dec 24)', () => {
  const pools = [{ id: 'bank', name: 'Bank', opening: 20000 }];
  const budgets = [
    {
      id: 'food',
      name: 'Food',
      kind: 'daily',
      amount: 6000,
      days: 30,
      start: '2026-12-01',
      funding: [{ poolId: 'bank', amount: 6000 }]
    }
  ];

  // Electricity bill due every 2 months on the 15th
  const obligations = [
    {
      id: 'elec',
      role: 'bill',
      counterparty: 'Electricity Co',
      principal: 2500,
      due: '2026-12-15',
      recurrence: { interval: 2, unit: 'months', anchorDate: '2026-10-15' },
      status: 'confirmed'
    },
    // One-off friend loan due Dec 24
    {
      id: 'loan',
      role: 'debt',
      counterparty: 'Sam',
      direction: 'pay',
      principal: 1000,
      outstanding: 1000,
      due: '2026-12-24',
      status: 'confirmed'
    }
  ];

  // Test balance at Dec 23: electricity has hit (Dec 15), but Sam's loan hasn't hit yet!
  const projDec23 = projectAtDate({
    targetDate: '2026-12-23',
    asOfDate: '2026-12-01',
    pools,
    budgets,
    obligations,
    ledgerEntries: []
  });

  const eventNamesDec23 = projDec23.events.map((e) => e.name);
  assert.ok(eventNamesDec23.includes('Electricity Co'));
  assert.ok(!eventNamesDec23.includes('Sam')); // Sam due Dec 24, not included in Dec 23!

  // Test balance at Dec 24: Sam's loan is now included!
  const projDec24 = projectAtDate({
    targetDate: '2026-12-24',
    asOfDate: '2026-12-01',
    pools,
    budgets,
    obligations,
    ledgerEntries: []
  });

  const eventNamesDec24 = projDec24.events.map((e) => e.name);
  assert.ok(eventNamesDec24.includes('Electricity Co'));
  assert.ok(eventNamesDec24.includes('Sam'));

  // Cap on Dec 24 is lower than Cap on Dec 23 by exactly Sam's 1000!
  assert.equal(projDec23.capProjected - projDec24.capProjected, 1000);
});
