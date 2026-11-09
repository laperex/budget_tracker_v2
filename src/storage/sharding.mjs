import { getMonthShard, todayISO } from '../domain/dateUtils.mjs';
import { createInitialConfig } from '../domain/types.mjs';

export const CONFIG_STORAGE_KEY = 'budget-tracker-v2-config';
export const LEDGER_PREFIX = 'budget-tracker-v2-ledger-';
export const MANIFEST_STORAGE_KEY = 'budget-tracker-v2-months-manifest';

/**
 * Partitions a flat array of ledger entries into a map of YYYY-MM -> entries[]
 */
export function partitionLedgerByMonth(entries = []) {
  const shards = new Map();
  for (const entry of entries) {
    const shard = getMonthShard(entry.date);
    if (!shards.has(shard)) {
      shards.set(shard, []);
    }
    shards.get(shard).push(entry);
  }
  return shards;
}

/**
 * Loads all known ledger entries from localStorage shards
 */
export function loadAllLedgerFromLocalStorage() {
  const entries = [];
  try {
    const manifestRaw = localStorage.getItem(MANIFEST_STORAGE_KEY);
    const months = manifestRaw ? JSON.parse(manifestRaw) : [];
    
    // Always include current month in manifest if not present
    const currentMonth = getMonthShard(todayISO());
    const allMonths = Array.from(new Set([...months, currentMonth]));

    for (const m of allMonths) {
      const raw = localStorage.getItem(LEDGER_PREFIX + m);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          entries.push(...parsed);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load ledger shards from localStorage:', err);
  }
  return entries;
}

/**
 * Saves partitioned ledger shards to localStorage and updates manifest
 */
export function saveLedgerToLocalStorage(entries = []) {
  try {
    const shards = partitionLedgerByMonth(entries);
    const months = Array.from(shards.keys());

    // Update manifest
    localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(months));

    // Write each shard
    for (const [month, shardEntries] of shards.entries()) {
      localStorage.setItem(LEDGER_PREFIX + month, JSON.stringify(shardEntries));
    }
  } catch (err) {
    console.error('Failed to save ledger shards to localStorage:', err);
  }
}

/**
 * Saves config to localStorage
 */
export function saveConfigToLocalStorage(config) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save config to localStorage:', err);
  }
}

/**
 * Loads config from localStorage with fallback to initial defaults
 */
export function loadConfigFromLocalStorage() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 2) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to load config from localStorage:', err);
  }
  return createInitialConfig();
}
