import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayNumber,
  dayDiff,
  addDays,
  addMonths,
  formatDate,
  formatINR,
  getCycleEnd,
  getMonthEnd,
  getCycleRange
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

test('dateUtils - getMonthEnd returns last calendar day of the month', () => {
  assert.equal(getMonthEnd('2026-11-05'), '2026-11-30'); // 30-day month
  assert.equal(getMonthEnd('2026-10-15'), '2026-10-31'); // 31-day month
  assert.equal(getMonthEnd('2026-02-10'), '2026-02-28'); // Non-leap Feb
  assert.equal(getMonthEnd('2024-02-10'), '2024-02-29'); // Leap Feb
});

test('dateUtils - getCycleRange computes accurate start and endDate for payday cycles', () => {
  // Cycle starts on the 1st
  const cycle1 = getCycleRange('2026-11-15', 1);
  assert.equal(cycle1.start, '2026-11-01');
  assert.equal(cycle1.endDate, '2026-11-30');

  // Cycle starts on the 15th, checking date on 20th
  const cycle15A = getCycleRange('2026-11-20', 15);
  assert.equal(cycle15A.start, '2026-11-15');
  assert.equal(cycle15A.endDate, '2026-12-14');

  // Cycle starts on the 15th, checking date on 5th (belongs to previous month's cycle)
  const cycle15B = getCycleRange('2026-11-05', 15);
  assert.equal(cycle15B.start, '2026-10-15');
  assert.equal(cycle15B.endDate, '2026-11-14');
});
