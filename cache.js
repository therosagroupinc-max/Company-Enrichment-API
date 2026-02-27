// cache.js — Simple SQLite cache for enrichment results
// Avoids re-scraping the same domain repeatedly, saving time and compute

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';

// Ensure data directory exists
if (!existsSync('./data')) {
  mkdirSync('./data', { recursive: true });
}

const db = new Database('./data/cache.db');

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create cache table
db.exec(`
  CREATE TABLE IF NOT EXISTS enrichment_cache (
    domain TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    hit_count INTEGER DEFAULT 0
  )
`);

// Cache duration: 7 days (in milliseconds)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Prepared statements for performance
const getStmt = db.prepare('SELECT data, created_at FROM enrichment_cache WHERE domain = ?');
const upsertStmt = db.prepare(`
  INSERT INTO enrichment_cache (domain, data, created_at, hit_count)
  VALUES (?, ?, ?, 0)
  ON CONFLICT(domain) DO UPDATE SET data = ?, created_at = ?, hit_count = 0
`);
const hitStmt = db.prepare('UPDATE enrichment_cache SET hit_count = hit_count + 1 WHERE domain = ?');

/**
 * Get cached enrichment data for a domain.
 * Returns null if not cached or expired.
 */
export function getCached(domain) {
  const row = getStmt.get(domain.toLowerCase());
  if (!row) return null;

  const age = Date.now() - row.created_at;
  if (age > CACHE_TTL_MS) return null; // Expired

  hitStmt.run(domain.toLowerCase());
  return JSON.parse(row.data);
}

/**
 * Store enrichment data in cache.
 */
export function setCache(domain, data) {
  const json = JSON.stringify(data);
  const now = Date.now();
  upsertStmt.run(domain.toLowerCase(), json, now, json, now);
}

/**
 * Get cache stats for monitoring.
 */
export function getCacheStats() {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_domains,
      SUM(hit_count) as total_hits,
      COUNT(CASE WHEN (? - created_at) <= ? THEN 1 END) as active_entries
    FROM enrichment_cache
  `).get(Date.now(), CACHE_TTL_MS);

  return stats;
}
