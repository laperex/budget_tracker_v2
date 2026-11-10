import { migrateV2toV3, migrateV1toV2 } from './migration.mjs';
import { deriveState } from '../domain/derive.mjs';

/**
 * Full state export and restore utilities for Budget Tracker v3 (and legacy v2 / v1).
 */

export function exportFullBackupJSON(recordsOrConfig, ledger = null) {
  const records = Array.isArray(recordsOrConfig)
    ? recordsOrConfig
    : (recordsOrConfig && Array.isArray(recordsOrConfig.records) ? recordsOrConfig.records : null);

  if (records) {
    let v2Config = null;
    let v2Ledger = null;
    try {
      const derived = deriveState(records);
      v2Config = {
        version: 2,
        cycleStartDay: derived.config?.cycleStartDay || 1,
        activeTab: 'overview',
        activeBudgetId: derived.budgets[0]?.id || null,
        pools: derived.pools,
        budgets: derived.budgets,
        obligations: derived.obligations,
        expectedIncomes: derived.expectedIncomes
      };
      v2Ledger = derived.transactions;
    } catch (e) {
      // Graceful fallback if derivation encounters edge case
    }

    const payload = {
      app: 'Budget Tracker v3',
      version: 3,
      exportedAt: new Date().toISOString(),
      records,
      ...(v2Config ? { config: v2Config, ledger: v2Ledger } : {})
    };
    return JSON.stringify(payload, null, 2);
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
  if (!jsonStr || (typeof jsonStr !== 'string' && typeof jsonStr !== 'object')) {
    throw new Error('Empty or invalid backup payload');
  }

  let parsed = jsonStr;
  if (typeof jsonStr === 'string') {
    const trimmed = jsonStr.trim();
    if (!trimmed) {
      throw new Error('Empty or invalid backup payload');
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error('Invalid JSON format: ' + err.message);
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup data is not a valid object or array');
  }

  // 1. Raw array of records: [ { id, type, date, data }, ... ]
  if (Array.isArray(parsed)) {
    return {
      version: 3,
      records: parsed
    };
  }

  // 2. Version 3 or object with records array: { version: 3, records: [...] } or { records: [...] }
  if (Array.isArray(parsed.records)) {
    return {
      version: 3,
      records: parsed.records
    };
  }

  // 3. Version 2 or object with config + ledger: { version: 2, config, ledger } or { config, ledger }
  if (parsed.config && (Array.isArray(parsed.ledger) || parsed.config.pools || parsed.config.budgets)) {
    const config = parsed.config;
    const ledger = Array.isArray(parsed.ledger) ? parsed.ledger : [];
    const pools = Array.isArray(config.pools) ? config.pools : [];
    const budgets = Array.isArray(config.budgets) ? config.budgets : [];
    const safeConfig = { ...config, pools, budgets };
    const convertedRecords = migrateV2toV3(safeConfig, ledger);
    return {
      version: 2,
      config: safeConfig,
      ledger,
      records: convertedRecords
    };
  }

  // 4. Legacy V1 format: { budgets: [ { id, name, amount, days, start, expenses: [...] } ] }
  if (Array.isArray(parsed.budgets)) {
    const v2Migrated = migrateV1toV2(parsed, typeof jsonStr === 'string' ? jsonStr : JSON.stringify(parsed));
    const convertedRecords = migrateV2toV3(v2Migrated.config, v2Migrated.ledgerEntries);
    return {
      version: 1,
      config: v2Migrated.config,
      ledger: v2Migrated.ledgerEntries,
      records: convertedRecords
    };
  }

  throw new Error('Unsupported backup format: payload must contain records array or config + ledger');
}

