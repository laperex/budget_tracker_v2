import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportFullBackupJSON, validateAndParseBackup } from '../src/storage/backup.mjs';

test('backup/restore - exports dual v3/v2 payload and restores cleanly', () => {
  const records = [
    { id: 'p1', type: 'pool', date: '2026-11-01', data: { name: 'UPI', opening: 5000, type: 'bank' } },
    { id: 'b1', type: 'budget', date: '2026-11-01', data: { name: 'Food', kind: 'daily', amount: 3000, days: 30, start: '2026-11-01' } },
    { id: 'e1', type: 'expense', date: '2026-11-02', data: { amount: 150, poolId: 'p1', budgetId: 'b1', note: 'Lunch' } }
  ];

  const jsonStr = exportFullBackupJSON(records);
  assert.ok(typeof jsonStr === 'string');

  const parsedJson = JSON.parse(jsonStr);
  assert.equal(parsedJson.version, 3);
  assert.ok(Array.isArray(parsedJson.records));
  assert.ok(parsedJson.config);
  assert.ok(Array.isArray(parsedJson.ledger));

  const restored = validateAndParseBackup(jsonStr);
  assert.equal(restored.version, 3);
  assert.equal(restored.records.length, 3);
  assert.equal(restored.records[2].data.amount, 150);
});

test('backup/restore - restores legacy v2 format', () => {
  const config = {
    version: 2,
    pools: [{ id: 'p1', name: 'Bank', opening: 1000 }],
    budgets: [{ id: 'b1', name: 'Food', kind: 'daily', amount: 5000, days: 30, start: '2026-11-01' }],
    obligations: []
  };

  const ledger = [
    { id: 'e1', date: '2026-11-02', type: 'expense', amount: 150, poolId: 'p1', budgetId: 'b1' }
  ];

  const payload = {
    app: 'Budget Tracker v2',
    version: 2,
    config,
    ledger
  };

  const restored = validateAndParseBackup(JSON.stringify(payload));
  assert.equal(restored.version, 2);
  assert.ok(Array.isArray(restored.records));
  assert.ok(restored.records.length >= 3);
});

test('backup/restore - restores raw record array', () => {
  const rawRecords = [
    { id: 'r1', type: 'pool', date: '2026-11-01', data: { name: 'Cash', opening: 500 } }
  ];
  const restored = validateAndParseBackup(JSON.stringify(rawRecords));
  assert.equal(restored.version, 3);
  assert.equal(restored.records.length, 1);
});

test('backup/restore - restores real user backup if present on disk', () => {
  const userPath = '/home/laperex/Downloads/budget-tracker-backup-2026-11-10.json';
  if (fs.existsSync(userPath)) {
    const raw = fs.readFileSync(userPath, 'utf8');
    const restored = validateAndParseBackup(raw);
    assert.equal(restored.version, 3);
    assert.equal(restored.records.length, 23);
  }
});

test('backup/restore - rejects invalid and corrupted payloads', () => {
  assert.throws(() => validateAndParseBackup(''), /Empty or invalid/);
  assert.throws(() => validateAndParseBackup('   '), /Empty or invalid/);
  assert.throws(() => validateAndParseBackup('{ invalid json }'), /Invalid JSON/);
  assert.throws(() => validateAndParseBackup(JSON.stringify({ someKey: 'unknown' })), /Unsupported backup format/);
});
