/**
 * Core type definitions, constants, and default seeds for Budget Tracker v2
 */

export const DEFAULT_POOLS = [
  { id: 'pool-bank', name: 'Bank Account', type: 'bank', opening: 0, isArchived: false },
  { id: 'pool-cash', name: 'Cash in Hand', type: 'cash', opening: 0, isArchived: false },
  { id: 'pool-upi', name: 'UPI / Wallet', type: 'upi', opening: 0, isArchived: false }
];

export const DEFAULT_ENVELOPES = [
  { id: 'env-impulse', name: 'Impulse', kind: 'envelope', funding: [], refillMonthly: false, refillAmount: 0, hardCap: true },
  { id: 'env-petrol', name: 'Petrol', kind: 'envelope', funding: [], refillMonthly: true, refillAmount: 2000, hardCap: false },
  { id: 'env-utilities', name: 'Utilities', kind: 'envelope', funding: [], refillMonthly: false, refillAmount: 0, hardCap: false },
  { id: 'env-rent', name: 'Rent', kind: 'envelope', funding: [], refillMonthly: true, refillAmount: 15000, hardCap: false },
  { id: 'env-misc', name: 'Misc', kind: 'envelope', funding: [], refillMonthly: false, refillAmount: 0, hardCap: false }
];

export const createInitialConfig = () => ({
  version: 2,
  cycleStartDay: 1,
  activeTab: 'overview',
  activeBudgetId: null,
  pools: [...DEFAULT_POOLS],
  budgets: [
    {
      id: 'budget-daily',
      name: 'Daily Spending',
      kind: 'daily',
      amount: 6000,
      days: 30,
      start: '2026-11-01',
      funding: [{ poolId: 'pool-bank', amount: 6000 }]
    },
    ...DEFAULT_ENVELOPES
  ],
  obligations: [],
  expectedIncomes: [],
  v1Migration: null
});
