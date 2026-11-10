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

test('projection - worst-case floor trajectory with budget envelopes already spent', () => {
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

  const obligations = [
    {
      id: 'elec',
      role: 'bill',
      direction: 'pay',
      counterparty: 'Electricity Co',
      principal: 2500,
      due: '2026-12-15',
      status: 'confirmed'
    },
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

  const proj = projectAtDate({
    targetDate: '2026-12-24',
    asOfDate: '2026-12-01',
    pools,
    budgets,
    obligations,
    ledgerEntries: []
  });

  const traj = proj.trajectory;
  assert.ok(traj.length > 0);

  // Day 0 (2026-12-01): 100% of food budget (6000) is deducted immediately: 20000 - 6000 = 14000
  assert.equal(traj[0].date, '2026-12-01');
  assert.equal(traj[0].worstCase, 14000);
  assert.equal(traj[0].cap, 20000); // Gradual cap starts at full 20000

  // Day 13 (2026-12-14): Still 14000 because electricity has not hit yet
  const ptDec14 = traj.find((t) => t.date === '2026-12-14');
  assert.equal(ptDec14.worstCase, 14000);

  // Day 14 (2026-12-15): Electricity bill of 2500 hits: 14000 - 2500 = 11500
  const ptDec15 = traj.find((t) => t.date === '2026-12-15');
  assert.equal(ptDec15.worstCase, 11500);

  // Day 23 (2026-12-24): Sam loan of 1000 hits: 11500 - 1000 = 10500
  const ptDec24 = traj.find((t) => t.date === '2026-12-24');
  assert.equal(ptDec24.worstCase, 10500);

  // At the target date, worstCase converges with capProjected
  assert.equal(ptDec24.worstCase, proj.capProjected);
  assert.equal(proj.worstCaseProjected, 10500);
});
