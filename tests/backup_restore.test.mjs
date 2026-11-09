import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFullBackupJSON, validateAndParseBackup } from '../src/storage/backup.mjs';

test('backup/restore - exports and restores full valid v2 state', () => {
  const config = {
    version: 2,
    pools: [{ id: 'p1', name: 'Bank', opening: 1000 }],
    budgets: [{ id: 'b1', name: 'Food', kind: 'daily', amount: 5000, days: 30, start: '2026-11-01' }],
    obligations: []
  };

  const ledger = [
    { id: 'e1', date: '2026-11-02', type: 'expense', amount: 150, poolId: 'p1', budgetId: 'b1' }
  ];

  const jsonStr = exportFullBackupJSON(config, ledger);
  assert.ok(typeof jsonStr === 'string');

  const restored = validateAndParseBackup(jsonStr);
  assert.equal(restored.version, 2);
  assert.deepEqual(restored.config.pools, config.pools);
  assert.deepEqual(restored.config.budgets, config.budgets);
  assert.deepEqual(restored.ledger, ledger);
});

test('backup/restore - rejects invalid and corrupted payloads', () => {
  assert.throws(() => validateAndParseBackup(''), /Empty or invalid/);
  assert.throws(() => validateAndParseBackup('{ invalid json }'), /Invalid JSON/);
  assert.throws(() => validateAndParseBackup(JSON.stringify({ version: 1 })), /Unsupported backup version/);
  assert.throws(() => validateAndParseBackup(JSON.stringify({ version: 2, config: {} })), /Invalid configuration structure/);
});
