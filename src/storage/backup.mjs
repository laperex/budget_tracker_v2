/**
 * Full state export and restore utilities for Budget Tracker v2
 */

export function exportFullBackupJSON(config, ledger) {
  const payload = {
    app: 'Budget Tracker v2',
    version: 2,
    exportedAt: new Date().toISOString(),
    config,
    ledger
  };
  return JSON.stringify(payload, null, 2);
}

export function validateAndParseBackup(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') {
    throw new Error('Empty or invalid backup payload');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('Invalid JSON format: ' + err.message);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup data is not a valid object');
  }

  if (parsed.version !== 2) {
    throw new Error('Unsupported backup version: expected v2');
  }

  if (!parsed.config || !Array.isArray(parsed.config.pools) || !Array.isArray(parsed.config.budgets)) {
    throw new Error('Invalid configuration structure in backup');
  }

  if (!Array.isArray(parsed.ledger)) {
    throw new Error('Invalid ledger structure in backup');
  }

  return parsed;
}
