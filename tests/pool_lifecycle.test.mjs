import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePoolBalances } from '../src/domain/ledger.mjs';
import { calculateCoreNumbers } from '../src/domain/totals.mjs';

test('pool lifecycle - archived pools are excluded from Total Available but retain historical ledger accuracy', () => {
  const pools = [
    { id: 'bank', name: 'Bank', opening: 5000, isArchived: false },
    { id: 'old-wallet', name: 'Old Cash Wallet', opening: 1000, isArchived: true }
  ];

  const ledger = [
    { id: '1', date: '2026-11-01', type: 'expense', poolId: 'old-wallet', amount: 200 }
  ];

  const core = calculateCoreNumbers({
    pools,
    budgets: [],
    obligations: [],
    ledgerEntries: ledger
  });

  // Total Available should ONLY include non-archived pools:
  assert.equal(core.totalAvailable, 5000);

  // But old-wallet's balance is preserved at 1000 - 200 = 800
  const balances = calculatePoolBalances(pools, ledger);
  assert.equal(balances.get('old-wallet').balance, 800);
});

test('pool lifecycle - closing transfer moves funds to new pool before archival', () => {
  const pools = [
    { id: 'old-bank', name: 'Old Bank', opening: 3000, isArchived: false },
    { id: 'new-bank', name: 'New Bank', opening: 1000, isArchived: false }
  ];

  // Transfer all 3000 from old-bank to new-bank
  const ledger = [
    { id: 't1', date: '2026-11-01', type: 'transfer', poolId: 'old-bank', toPoolId: 'new-bank', amount: 3000 }
  ];

  // Now archive old-bank
  pools[0].isArchived = true;

  const core = calculateCoreNumbers({
    pools,
    budgets: [],
    obligations: [],
    ledgerEntries: ledger
  });

  // New bank has 1000 + 3000 = 4000. Total available is 4000
  assert.equal(core.totalAvailable, 4000);
  const balances = calculatePoolBalances(pools, ledger);
  assert.equal(balances.get('old-bank').balance, 0);
  assert.equal(balances.get('new-bank').balance, 4000);
});
