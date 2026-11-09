import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateObligationState,
  groupObligationsByPerson,
  advanceBillCycle
} from '../src/domain/obligations.mjs';

test('obligations - partial repayment and settlement', () => {
  const debt = {
    id: 'debt1',
    role: 'debt',
    counterparty: 'Charlie',
    direction: 'pay',
    principal: 1000,
    status: 'confirmed'
  };

  // Initially: outstanding 1000
  const s0 = calculateObligationState(debt, []);
  assert.equal(s0.outstanding, 1000);
  assert.equal(s0.status, 'confirmed');

  // Repay 400 -> outstanding 600, status partial
  const ledger = [
    { id: 'r1', type: 'repayment', obligationId: 'debt1', amount: 400, direction: 'out' }
  ];
  const s1 = calculateObligationState(debt, ledger);
  assert.equal(s1.outstanding, 600);
  assert.equal(s1.status, 'partial');

  // Repay remaining 600 -> outstanding 0, status settled
  ledger.push({ id: 'r2', type: 'repayment', obligationId: 'debt1', amount: 600, direction: 'out' });
  const s2 = calculateObligationState(debt, ledger);
  assert.equal(s2.outstanding, 0);
  assert.equal(s2.status, 'settled');
  assert.equal(s2.isClosed, true);
});

test('obligations - forgiven debts close with zero outstanding and no ledger distortion', () => {
  const debt = {
    id: 'debt2',
    role: 'debt',
    counterparty: 'David',
    direction: 'pay',
    principal: 500,
    status: 'forgiven'
  };

  const state = calculateObligationState(debt, []);
  assert.equal(state.outstanding, 0);
  assert.equal(state.status, 'forgiven');
  assert.equal(state.isClosed, true);
});

test('obligations - per-person counterparty netting', () => {
  const obligations = [
    // I lent Alice 1200
    { id: 'o1', role: 'receivable', counterparty: 'Alice', direction: 'receive', principal: 1200, status: 'confirmed' },
    // Alice covered a 400 cab for me (I owe Alice 400)
    { id: 'o2', role: 'debt', counterparty: 'Alice', direction: 'pay', principal: 400, status: 'confirmed' }
  ];

  const people = groupObligationsByPerson(obligations, []);
  assert.equal(people.length, 1);
  const alice = people[0];
  assert.equal(alice.person, 'Alice');
  // Net balance: 1200 - 400 = +800 (Alice owes me 800)
  assert.equal(alice.confirmedNet, 800);
  assert.equal(alice.netBalance, 800);
});

test('obligations - bill cycle advance', () => {
  const bimonthlyBill = {
    id: 'elec',
    role: 'bill',
    counterparty: 'Power Co',
    principal: 2000,
    due: '2026-10-15',
    recurrence: { interval: 2, unit: 'months', anchorDate: '2026-10-15' }
  };

  const advanced = advanceBillCycle(bimonthlyBill, '2026-10-16');
  assert.equal(advanced.due, '2026-12-15');
});

test('obligations - undated / ignore day-dates interpersonal debts netting', () => {
  const obligations = [
    // Open informal debt to Bob (ignore due date)
    { id: 'o-bob-1', role: 'debt', counterparty: 'Bob', direction: 'pay', principal: 1500, ignoreDueDate: true, due: null, status: 'confirmed' },
    // Open informal receivable from Bob
    { id: 'o-bob-2', role: 'receivable', counterparty: 'Bob', direction: 'receive', principal: 500, ignoreDueDate: true, due: null, status: 'confirmed' }
  ];

  const people = groupObligationsByPerson(obligations, []);
  assert.equal(people.length, 1);
  const bob = people[0];
  assert.equal(bob.person, 'Bob');
  // Net balance: 500 - 1500 = -1000 (You owe Bob 1000)
  assert.equal(bob.confirmedNet, -1000);
  assert.equal(bob.netBalance, -1000);
  assert.equal(bob.debts[0].ignoreDueDate, true);
});
