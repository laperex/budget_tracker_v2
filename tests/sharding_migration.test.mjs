import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionLedgerByMonth } from '../src/storage/sharding.mjs';
import { migrateV1toV2 } from '../src/storage/migration.mjs';

test('sharding - partitions ledger by YYYY-MM month boundaries', () => {
  const entries = [
    { id: '1', date: '2026-10-28', amount: 50 },
    { id: '2', date: '2026-10-31', amount: 150 },
    { id: '3', date: '2026-11-01', amount: 200 },
    { id: '4', date: '2026-12-15', amount: 300 }
  ];

  const shards = partitionLedgerByMonth(entries);
  assert.equal(shards.size, 3);
  assert.equal(shards.get('2026-10').length, 2);
  assert.equal(shards.get('2026-11').length, 1);
  assert.equal(shards.get('2026-12').length, 1);
});

test('migration - seamlessly migrates v1 budget and expenses into v2 schema', () => {
  const v1Sample = {
    budgets: [
      {
        id: 'food-v1',
        name: 'Food & Dining',
        amount: 8000,
        days: 30,
        start: '2026-11-01',
        expenses: [
          { id: 'e1', date: '2026-11-02', amt: 350, note: 'groceries' },
          { id: 'e2', date: '2026-11-03', amt: 200, note: 'cafe' }
        ]
      }
    ],
    active: 'food-v1'
  };

  const { config, ledgerEntries } = migrateV1toV2(v1Sample);

  assert.equal(config.version, 2);
  assert.equal(config.pools.length, 3);
  assert.equal(config.budgets[0].id, 'food-v1');
  assert.equal(config.budgets[0].kind, 'daily');
  assert.equal(config.budgets[0].amount, 8000);

  // Check ledger entries
  assert.equal(ledgerEntries.length, 2);
  assert.equal(ledgerEntries[0].amount, 350);
  assert.equal(ledgerEntries[0].budgetId, 'food-v1');
  assert.equal(ledgerEntries[0].poolId, 'pool-bank');
  assert.equal(ledgerEntries[1].amount, 200);

  // Check default envelopes added
  const envNames = config.budgets.map((b) => b.name);
  assert.ok(envNames.includes('Impulse'));
  assert.ok(envNames.includes('Rent'));
  assert.ok(envNames.includes('Petrol'));
});
