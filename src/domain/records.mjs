/**
 * Record schema, constants, and CRUD operations for Budget Tracker v3.
 * Everything in the system is stored as a flat array of records.
 */

export const ENTITY_TYPES = new Set([
  'config',
  'pool',
  'budget',
  'obligation',
  'expected-income'
]);

export const TRANSACTION_TYPES = new Set([
  'expense',
  'income',
  'transfer',
  'loan-out',
  'loan_out',
  'loan-in',
  'loan_in',
  'repayment',
  'adjustment',
  'allocation'
]);

export const ALL_RECORD_TYPES = new Set([
  ...ENTITY_TYPES,
  ...TRANSACTION_TYPES
]);

/**
 * Generates a unique ID (UUID or fallback)
 */
export function generateRecordId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'rec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

/**
 * Creates a new normalized record object
 */
export function createRecord(type, date, data = {}, id = null) {
  const normalizedType = type === 'loan_out' ? 'loan-out' : type === 'loan_in' ? 'loan-in' : type;
  return {
    id: id || generateRecordId(),
    ts: new Date().toISOString(),
    type: normalizedType,
    date: date || new Date().toISOString().slice(0, 10),
    data: { ...data }
  };
}

/**
 * Edits an existing record by id.
 * Returns a new array with the target record updated and updated timestamp `ts`.
 */
export function editRecord(records, id, updates = {}) {
  const now = new Date().toISOString();
  return records.map((r) => {
    if (r.id !== id) return r;

    const nextType = updates.type ? (updates.type === 'loan_out' ? 'loan-out' : updates.type === 'loan_in' ? 'loan-in' : updates.type) : r.type;
    const nextDate = updates.date != null ? updates.date : r.date;
    const nextData = { ...r.data, ...(updates.data || {}) };

    return {
      ...r,
      ts: now,
      type: nextType,
      date: nextDate,
      data: nextData
    };
  });
}

/**
 * Deletes a record by id.
 * Returns a new array with the target record removed.
 */
export function deleteRecord(records, id) {
  return records.filter((r) => r.id !== id);
}

/**
 * Clears all records completely.
 */
export function clearAllRecords() {
  return [];
}

/**
 * Creates default initial seed records for a fresh installation.
 */
export function createInitialSeedRecords() {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonthStart = today.slice(0, 8) + '01';

  return [
    createRecord('config', today, { cycleStartDay: 1 }, 'config-system'),
    createRecord('pool', today, { name: 'Bank Account', poolType: 'bank', opening: 0, isArchived: false }, 'pool-bank'),
    createRecord('pool', today, { name: 'Cash in Hand', poolType: 'cash', opening: 0, isArchived: false }, 'pool-cash'),
    createRecord('pool', today, { name: 'UPI / Wallet', poolType: 'upi', opening: 0, isArchived: false }, 'pool-upi'),
    createRecord('budget', currentMonthStart, {
      name: 'Daily Spending',
      kind: 'daily',
      amount: 6000,
      days: 30,
      start: currentMonthStart,
      funding: [{ poolId: 'pool-bank', amount: 6000 }]
    }, 'budget-daily'),
    createRecord('budget', currentMonthStart, {
      name: 'Impulse',
      kind: 'envelope',
      funding: [],
      refillMonthly: false,
      refillAmount: 0,
      hardCap: true
    }, 'env-impulse'),
    createRecord('budget', currentMonthStart, {
      name: 'Petrol',
      kind: 'envelope',
      funding: [],
      refillMonthly: true,
      refillAmount: 2000,
      hardCap: false
    }, 'env-petrol'),
    createRecord('budget', currentMonthStart, {
      name: 'Utilities',
      kind: 'envelope',
      funding: [],
      refillMonthly: false,
      refillAmount: 0,
      hardCap: false
    }, 'env-utilities'),
    createRecord('budget', currentMonthStart, {
      name: 'Rent',
      kind: 'envelope',
      funding: [],
      refillMonthly: true,
      refillAmount: 15000,
      hardCap: false
    }, 'env-rent'),
    createRecord('budget', currentMonthStart, {
      name: 'Misc',
      kind: 'envelope',
      funding: [],
      refillMonthly: false,
      refillAmount: 0,
      hardCap: false
    }, 'env-misc')
  ];
}
