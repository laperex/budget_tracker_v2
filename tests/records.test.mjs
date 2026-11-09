import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecord,
  editRecord,
  deleteRecord,
  clearAllRecords,
  createInitialSeedRecords,
  ALL_RECORD_TYPES
} from '../src/domain/records.mjs';
import { deriveState, computeDashboardFromRecords } from '../src/domain/derive.mjs';
import { migrateV2toV3 } from '../src/storage/migration.mjs';
import { exportFullBackupJSON, validateAndParseBackup } from '../src/storage/backup.mjs';

test('records - CRUD operations on flat record array', () => {
  let records = [];

  // Create
  const r1 = createRecord('pool', '2026-11-01', { name: 'Bank', poolType: 'bank', opening: 10000 });
  const r2 = createRecord('expense', '2026-11-02', { amount: 500, poolId: r1.id, note: 'Dinner' });
  records.push(r1, r2);

  assert.equal(records.length, 2);
  assert.equal(records[0].type, 'pool');
  assert.equal(records[1].type, 'expense');
  assert.equal(records[1].data.amount, 500);

  // Edit record
  records = editRecord(records, r2.id, { data: { amount: 750, note: 'Dinner with drinks' } });
  const edited = records.find((r) => r.id === r2.id);
  assert.equal(edited.data.amount, 750);
  assert.equal(edited.data.note, 'Dinner with drinks');

  // Edit date
  records = editRecord(records, r2.id, { date: '2026-11-03' });
  assert.equal(records.find((r) => r.id === r2.id).date, '2026-11-03');

  // Delete record
  records = deleteRecord(records, r2.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, r1.id);

  // Clear all
  records = clearAllRecords();
  assert.equal(records.length, 0);
});

test('deriveState - pure derivation of entities, transactions, and core numbers', () => {
  let records = [
    createRecord('config', '2026-11-01', { cycleStartDay: 1 }),
    createRecord('pool', '2026-11-01', { name: 'Bank', poolType: 'bank', opening: 20000 }, 'p1'),
    createRecord('pool', '2026-11-01', { name: 'Cash', poolType: 'cash', opening: 5000 }, 'p2'),
    createRecord('budget', '2026-11-01', { name: 'Food', kind: 'daily', amount: 6000, days: 30, start: '2026-11-01', funding: [{ poolId: 'p1', amount: 6000 }] }, 'b1'),
    createRecord('expense', '2026-11-02', { amount: 500, poolId: 'p1', budgetId: 'b1', note: 'Groceries' }, 'tx1'),
    createRecord('transfer', '2026-11-03', { amount: 2000, poolId: 'p1', toPoolId: 'p2', note: 'ATM' }, 'tx2')
  ];

  // Derive initial state
  let dash = computeDashboardFromRecords(records, { asOfDate: '2026-11-05' });
  
  // Total available = (20000 - 500 - 2000) + (5000 + 2000) = 17500 + 7000 = 24500
  assert.equal(dash.coreNumbers.totalAvailable, 24500);

  const bank = dash.coreNumbers.poolBalances.find((p) => p.id === 'p1');
  const cash = dash.coreNumbers.poolBalances.find((p) => p.id === 'p2');
  assert.equal(bank.balance, 17500);
  assert.equal(cash.balance, 7000);

  // EDIT record: change expense amount from 500 to 1000
  records = editRecord(records, 'tx1', { data: { amount: 1000 } });
  dash = computeDashboardFromRecords(records, { asOfDate: '2026-11-05' });

  // Bank should now be 20000 - 1000 - 2000 = 17000, totalAvailable = 24000
  const updatedBank = dash.coreNumbers.poolBalances.find((p) => p.id === 'p1');
  assert.equal(updatedBank.balance, 17000);
  assert.equal(dash.coreNumbers.totalAvailable, 24000);

  // DELETE record: delete the transfer
  records = deleteRecord(records, 'tx2');
  dash = computeDashboardFromRecords(records, { asOfDate: '2026-11-05' });

  // Bank: 20000 - 1000 = 19000, Cash: 5000 (pre-transfer), total: 24000
  const postDelBank = dash.coreNumbers.poolBalances.find((p) => p.id === 'p1');
  const postDelCash = dash.coreNumbers.poolBalances.find((p) => p.id === 'p2');
  assert.equal(postDelBank.balance, 19000);
  assert.equal(postDelCash.balance, 5000);
});

test('migration - seamlessly migrates v2 config and ledger to v3 records', () => {
  const v2Config = {
    version: 2,
    cycleStartDay: 5,
    pools: [
      { id: 'p-hdfc', name: 'HDFC', type: 'bank', opening: 15000, isArchived: false }
    ],
    budgets: [
      { id: 'b-fuel', name: 'Fuel', kind: 'envelope', amount: 2000, funding: [] }
    ],
    obligations: [
      { id: 'ob-1', role: 'bill', counterparty: 'Wifi', direction: 'pay', principal: 1000, due: '2026-11-20', status: 'confirmed' }
    ],
    expectedIncomes: [
      { id: 'inc-1', source: 'Consulting', amount: 30000, date: '2026-11-25', likelihood: 80 }
    ]
  };

  const v2Ledger = [
    { id: 'tx-1', date: '2026-11-06', type: 'expense', amount: 800, poolId: 'p-hdfc', budgetId: 'b-fuel' },
    { id: 'tx-2', date: '2026-11-07', type: 'loan_out', amount: 500, poolId: 'p-hdfc', obligationId: 'ob-1' }
  ];

  const v3Records = migrateV2toV3(v2Config, v2Ledger);
  assert(Array.isArray(v3Records));
  assert.equal(v3Records.length, 7); // 1 config + 1 pool + 1 budget + 1 obligation + 1 income + 2 transactions = 7

  const derived = deriveState(v3Records);
  assert.equal(derived.config.cycleStartDay, 5);
  assert.equal(derived.pools.length, 1);
  assert.equal(derived.budgets.length, 1);
  assert.equal(derived.obligations.length, 1);
  assert.equal(derived.expectedIncomes.length, 1);
  assert.equal(derived.transactions.length, 2);
  assert.equal(derived.transactions[1].type, 'loan-out'); // loan_out mapped to loan-out
});

test('backup & restore - handles v3 records format and v2 compatibility', () => {
  const seedRecords = createInitialSeedRecords();
  const backupJSON = exportFullBackupJSON(seedRecords);

  const restored = validateAndParseBackup(backupJSON);
  assert.equal(restored.version, 3);
  assert.equal(restored.records.length, seedRecords.length);

  // Test backward compatibility with legacy v2 backup
  const legacyV2JSON = JSON.stringify({
    version: 2,
    config: { pools: [{ id: 'p1', name: 'Bank', opening: 1000 }], budgets: [] },
    ledger: [{ id: 'tx1', type: 'expense', amount: 100, poolId: 'p1', date: '2026-11-01' }]
  });

  const converted = validateAndParseBackup(legacyV2JSON);
  assert.equal(converted.version, 2);
  assert(Array.isArray(converted.records));
  assert(converted.records.length > 0);
});
