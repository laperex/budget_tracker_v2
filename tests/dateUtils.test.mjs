import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayNumber,
  dayDiff,
  addDays,
  addMonths,
  formatDate,
  formatINR,
  getCycleEnd
} from '../src/domain/dateUtils.mjs';

test('dateUtils - day arithmetic and formatting', () => {
  const d1 = '2026-11-01';
  const d2 = '2026-11-15';
  assert.equal(dayDiff(d1, d2), 14);
  assert.equal(addDays(d1, 14), d2);
  assert.equal(addDays(d2, -14), d1);
});

test('dateUtils - addMonths respects calendar boundaries', () => {
  assert.equal(addMonths('2026-11-01', 1), '2026-12-01');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
});

test('dateUtils - formatINR currency representation', () => {
  assert.equal(formatINR(1000), '₹1,000');
  assert.equal(formatINR(-500), '−₹500');
  assert.equal(formatINR(1234567), '₹12,34,567');
});

test('dateUtils - getCycleEnd computes correct reset date', () => {
  assert.equal(getCycleEnd('2026-11-05', 1), '2026-12-01');
  assert.equal(getCycleEnd('2026-10-25', 1), '2026-11-01');
});
