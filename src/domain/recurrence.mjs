import { parseISO, formatDate, addDays, dayNumber } from './dateUtils.mjs';

/**
 * Computes all occurrence dates of a recurring rule between fromDate and targetDate inclusive.
 * Handles interval in months, weeks, or days.
 *
 * @param {Object} rule
 * @param {number} rule.interval - e.g. 1 (monthly), 2 (every 2 months for electricity)
 * @param {'months'|'weeks'|'days'} rule.unit
 * @param {string} rule.anchorDate - Base starting date 'YYYY-MM-DD'
 * @param {string} targetDate - End of horizon 'YYYY-MM-DD'
 * @param {string|null} fromDate - Earliest date to include (inclusive, default null = all >= anchorDate)
 * @returns {string[]} Array of ISO dates
 */
export function getOccurrencesUpTo(rule, targetDate, fromDate = null) {
  if (!rule || !rule.anchorDate || !targetDate) return [];
  const interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  const unit = rule.unit || 'months';

  const anchor = parseISO(rule.anchorDate);
  const targetDayNum = dayNumber(targetDate);
  const fromDayNum = fromDate ? dayNumber(fromDate) : null;

  const occurrences = [];
  let curr = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  let iteration = 0;
  const maxIterations = 240; // Guard against runaway loops (e.g. 20 years)

  while (iteration++ < maxIterations) {
    const currStr = formatDate(curr);
    const currDayNum = dayNumber(currStr);

    if (currDayNum > targetDayNum) {
      break;
    }

    if (fromDayNum === null || currDayNum >= fromDayNum) {
      occurrences.push(currStr);
    }

    // Step forward
    if (unit === 'months') {
      const nextMonth = curr.getMonth() + interval;
      const originalDay = anchor.getDate();
      // Handle month end clipping (e.g. 31st to 30th/28th)
      const testDate = new Date(curr.getFullYear(), nextMonth, 1);
      const daysInNextMonth = new Date(testDate.getFullYear(), testDate.getMonth() + 1, 0).getDate();
      curr = new Date(testDate.getFullYear(), testDate.getMonth(), Math.min(originalDay, daysInNextMonth));
    } else if (unit === 'weeks') {
      curr = parseISO(addDays(currStr, interval * 7));
    } else if (unit === 'days') {
      curr = parseISO(addDays(currStr, interval));
    } else {
      break;
    }
  }

  return occurrences;
}

/**
 * Returns the next upcoming occurrence strictly >= afterDate
 */
export function getNextOccurrence(rule, afterDate) {
  if (!rule || !rule.anchorDate) return null;
  const afterDayNum = dayNumber(afterDate);
  const interval = Math.max(1, Math.floor(Number(rule.interval) || 1));
  const unit = rule.unit || 'months';

  let curr = parseISO(rule.anchorDate);
  let iteration = 0;
  while (iteration++ < 240) {
    const currStr = formatDate(curr);
    if (dayNumber(currStr) >= afterDayNum) {
      return currStr;
    }
    if (unit === 'months') {
      const nextMonth = curr.getMonth() + interval;
      curr = new Date(curr.getFullYear(), nextMonth, curr.getDate());
    } else if (unit === 'weeks') {
      curr = parseISO(addDays(currStr, interval * 7));
    } else {
      curr = parseISO(addDays(currStr, interval));
    }
  }
  return null;
}
