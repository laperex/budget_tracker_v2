import test from 'node:test';
import assert from 'node:assert/strict';
import { getOccurrencesUpTo, getNextOccurrence } from '../src/domain/recurrence.mjs';

test('recurrence - electricity once every 2 months', () => {
  const electricityRule = {
    interval: 2,
    unit: 'months',
    anchorDate: '2026-10-15'
  };

  // Up to Dec 10: only Oct 15
  const occ1 = getOccurrencesUpTo(electricityRule, '2026-12-10', '2026-11-01');
  assert.deepEqual(occ1, []); // none between Nov 1 and Dec 10

  // Up to Dec 23: Dec 15 hits!
  const occ2 = getOccurrencesUpTo(electricityRule, '2026-12-23', '2026-11-01');
  assert.deepEqual(occ2, ['2026-12-15']);

  // Up to Mar 01, 2027: Dec 15 and Feb 15 hit!
  const occ3 = getOccurrencesUpTo(electricityRule, '2027-03-01', '2026-11-01');
  assert.deepEqual(occ3, ['2026-12-15', '2027-02-15']);
});

test('recurrence - monthly rent recurrence', () => {
  const rentRule = {
    interval: 1,
    unit: 'months',
    anchorDate: '2026-11-01'
  };

  const occ = getOccurrencesUpTo(rentRule, '2027-01-15', '2026-11-01');
  assert.deepEqual(occ, ['2026-11-01', '2026-12-01', '2027-01-01']);
});

test('recurrence - getNextOccurrence', () => {
  const rule = { interval: 2, unit: 'months', anchorDate: '2026-10-15' };
  assert.equal(getNextOccurrence(rule, '2026-11-01'), '2026-12-15');
  assert.equal(getNextOccurrence(rule, '2026-12-16'), '2027-02-15');
});
