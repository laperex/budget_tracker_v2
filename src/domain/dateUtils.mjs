/**
 * Pure date utility functions using local ISO strings (YYYY-MM-DD)
 * and day arithmetic via UTC day numbers.
 */

export const pad2 = (n) => String(n).padStart(2, '0');

export const formatDate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const todayISO = () => formatDate(new Date());

export const parseISO = (s) => {
  if (!s || typeof s !== 'string') return new Date();
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};

/**
 * Returns UTC day number for YYYY-MM-DD
 */
export const dayNumber = (s) => {
  if (!s) return 0;
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d || 1) / 864e5);
};

export const dayDiff = (startStr, endStr) => {
  return dayNumber(endStr) - dayNumber(startStr);
};

export const addDays = (s, k) => {
  const [y, m, d] = s.split('-').map(Number);
  const next = new Date(y, m - 1, (d || 1) + k);
  return formatDate(next);
};

export const addMonths = (s, mCount) => {
  const [y, m, d] = s.split('-').map(Number);
  // Target month and year
  const targetMonthIndex = (m - 1) + mCount;
  const next = new Date(y, targetMonthIndex, d || 1);
  return formatDate(next);
};

export const shortDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short'
  });
};

export const formatINR = (n) => {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  const isNeg = r < 0;
  const abs = Math.abs(r);
  return (isNeg ? '−₹' : '₹') + abs.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

export const getMonthShard = (dateStr) => {
  const s = dateStr || todayISO();
  return s.slice(0, 7); // YYYY-MM
};

export const getCycleEnd = (todayStr, cycleDay = 1) => {
  const [y, m, d] = (todayStr || todayISO()).split('-').map(Number);
  let nextCycleDate;
  if (d < cycleDay) {
    nextCycleDate = new Date(y, m - 1, cycleDay);
  } else {
    nextCycleDate = new Date(y, m, cycleDay);
  }
  return formatDate(nextCycleDate);
};
