import { aggregateObligationPayments } from './ledger.mjs';
import { getNextOccurrence } from './recurrence.mjs';
import { todayISO } from './dateUtils.mjs';

/**
 * Calculates dynamic outstanding balance and status for an obligation based on ledger payments.
 */
export function calculateObligationState(obligation, ledgerEntries = []) {
  const principal = Number(obligation.principal) || 0;
  const status = obligation.status || 'confirmed';

  if (status === 'cancelled' || status === 'forgiven') {
    return {
      ...obligation,
      principal,
      totalPaid: 0,
      outstanding: 0,
      status,
      isClosed: true
    };
  }

  const paymentsMap = aggregateObligationPayments(ledgerEntries);
  const totalPaid = paymentsMap.get(obligation.id) || 0;
  const outstanding = Math.max(0, principal - totalPaid);

  let derivedStatus = status;
  if (status !== 'potential') {
    if (outstanding <= 0.001) {
      derivedStatus = 'settled';
    } else if (totalPaid > 0) {
      derivedStatus = 'partial';
    } else {
      derivedStatus = 'confirmed';
    }
  }

  const staticFunded = (obligation.funding || []).reduce(
    (sum, f) => sum + (Number(f.amount) || 0),
    0
  );
  const fundedRemaining = Math.max(0, staticFunded - totalPaid);

  return {
    ...obligation,
    principal,
    totalPaid,
    outstanding,
    fundedRemaining,
    status: derivedStatus,
    isClosed: derivedStatus === 'settled',
    likelihood: typeof obligation.likelihood === 'number' ? obligation.likelihood : (status === 'potential' ? 50 : 100)
  };
}

/**
 * Groups obligations by counterparty person to calculate net balances.
 * Returns map of personName -> { debts: [], receivables: [], netBalance: number }
 * netBalance > 0 means they owe me; netBalance < 0 means I owe them.
 */
export function groupObligationsByPerson(obligations, ledgerEntries = []) {
  const peopleMap = new Map();

  for (const ob of obligations) {
    if (ob.role === 'bill') continue; // Bills are institutional, not interpersonal debts
    const name = (ob.counterparty || 'Unnamed').trim();
    if (!name) continue;

    if (!peopleMap.has(name)) {
      peopleMap.set(name, {
        person: name,
        debts: [],
        receivables: [],
        netBalance: 0,
        confirmedNet: 0
      });
    }

    const state = calculateObligationState(ob, ledgerEntries);
    const personObj = peopleMap.get(name);

    if (state.direction === 'pay') {
      personObj.debts.push(state);
      if (state.status !== 'cancelled' && state.status !== 'forgiven') {
        const weight = state.status === 'potential' ? (state.likelihood / 100) : 1;
        personObj.netBalance -= state.outstanding * weight;
        if (state.status !== 'potential') {
          personObj.confirmedNet -= state.outstanding;
        }
      }
    } else {
      personObj.receivables.push(state);
      if (state.status !== 'cancelled' && state.status !== 'forgiven') {
        const weight = state.status === 'potential' ? (state.likelihood / 100) : 1;
        personObj.netBalance += state.outstanding * weight;
        if (state.status !== 'potential') {
          personObj.confirmedNet += state.outstanding;
        }
      }
    }
  }

  return Array.from(peopleMap.values()).sort((a, b) => a.person.localeCompare(b.person));
}

/**
 * Advances a recurring bill to its next due date after payment
 */
export function advanceBillCycle(bill, asOfDate = todayISO()) {
  if (!bill.recurrence) return bill;
  const nextDate = getNextOccurrence(bill.recurrence, asOfDate);
  return {
    ...bill,
    due: nextDate || bill.due
  };
}

/**
 * Scans all records and returns a unique, sorted list of known counterparty names.
 *
 * @param {Array} records - All database records or entities
 * @returns {string[]} - Array of unique trimmed names
 */
export function extractKnownPeople(records = []) {
  const set = new Set();
  for (const r of records) {
    const d = r.data || r;
    if (typeof d.counterparty === 'string' && d.counterparty.trim()) {
      set.add(d.counterparty.trim());
    }
    if (typeof d.person === 'string' && d.person.trim()) {
      set.add(d.person.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

