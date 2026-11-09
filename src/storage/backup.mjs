import { migrateV2toV3 } from './migration.mjs';

/**
 * Full state export and restore utilities for Budget Tracker v3 (and legacy v2).
 */

export function exportFullBackupJSON(recordsOrConfig, ledger = null) {
  if (Array.isArray(recordsOrConfig)) {
    return JSON.stringify({
      app: 'Budget Tracker v3',
      version: 3,
      exportedAt: new Date().toISOString(),
      records: recordsOrConfig
    }, null, 2);
  }

  if (recordsOrConfig && Array.isArray(recordsOrConfig.records)) {
    return JSON.stringify({
      app: 'Budget Tracker v3',
      version: 3,
      exportedAt: new Date().toISOString(),
      records: recordsOrConfig.records
    }, null, 2);
  }

  // Legacy v2 signature: exportFullBackupJSON(config, ledger)
  const payload = {
    app: 'Budget Tracker v2',
    version: 2,
    exportedAt: new Date().toISOString(),
    config: recordsOrConfig,
    ledger: Array.isArray(ledger) ? ledger : []
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

  // Version 3: Single records array
  if (parsed.version === 3) {
    if (!Array.isArray(parsed.records)) {
      throw new Error('Invalid v3 backup structure: missing records array');
    }
    return {
      version: 3,
      records: parsed.records
    };
  }

  // Version 2: config + ledger
  if (parsed.version === 2) {
    if (!parsed.config || !Array.isArray(parsed.config.pools) || !Array.isArray(parsed.config.budgets)) {
      throw new Error('Invalid configuration structure in backup');
    }
    if (!Array.isArray(parsed.ledger)) {
      throw new Error('Invalid ledger structure in backup');
    }
    const convertedRecords = migrateV2toV3(parsed.config, parsed.ledger);
    return {
      version: 2,
      config: parsed.config,
      ledger: parsed.ledger,
      records: convertedRecords
    };
  }

  throw new Error('Unsupported backup version: expected v2 or v3');
}
