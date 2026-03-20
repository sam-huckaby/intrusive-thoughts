import { Database } from "bun:sqlite";
import type { ReviewerProfile, ReviewRule } from "../../types";

/**
 * Loads all enabled reviewer profiles from the database.
 */
export function getEnabledProfiles(db: Database): ReviewerProfile[] {
  const rows = db
    .query(
      `SELECT id, slug, name, description, prompt, file_patterns, enabled,
              source_hash, created_at, updated_at
       FROM reviewer_profiles
       WHERE enabled = 1
       ORDER BY slug`,
    )
    .all() as RawProfileRow[];

  return rows.map(rowToProfile);
}

/**
 * Loads a single reviewer profile by slug.
 * Returns null if not found.
 */
export function getProfileBySlug(
  db: Database,
  slug: string,
): ReviewerProfile | null {
  const row = db
    .query(
      `SELECT id, slug, name, description, prompt, file_patterns, enabled,
              source_hash, created_at, updated_at
       FROM reviewer_profiles
       WHERE slug = ?`,
    )
    .get(slug) as RawProfileRow | null;

  return row ? rowToProfile(row) : null;
}

/**
 * Loads the configured fallback profile.
 * Falls back to slug "general" if the config key is missing.
 * Returns null if the fallback profile doesn't exist in the DB.
 */
export function getFallbackProfile(db: Database): ReviewerProfile | null {
  const configRow = db
    .query("SELECT value FROM config WHERE key = 'fallbackProfile'")
    .get() as { value: string } | null;

  const slug = configRow?.value ?? "general";
  return getProfileBySlug(db, slug);
}

/**
 * Loads the rules linked to a specific profile, filtered to only enabled rules.
 * This implements the "global pool, per-profile linking" design:
 * - Only rules linked via profile_rules are included
 * - Only rules with enabled = 1 are included (global kill-switch)
 */
export function getProfileRules(
  db: Database,
  profileId: number,
): ReviewRule[] {
  const rows = db
    .query(
      `SELECT r.id, r.slug, r.name, r.description, r.category, r.severity,
              r.enabled, r.source_hash, r.created_at, r.updated_at
       FROM rules r
       JOIN profile_rules pr ON pr.rule_id = r.id
       WHERE pr.profile_id = ? AND r.enabled = 1
       ORDER BY r.name`,
    )
    .all(profileId) as RawRuleRow[];

  return rows.map(rowToRule);
}

// ─── Internal types and helpers ──────────────────────────

interface RawProfileRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  prompt: string;
  file_patterns: string;
  enabled: number;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface RawRuleRow {
  id: number;
  slug: string | null;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: number;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: RawProfileRow): ReviewerProfile {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    filePatterns: JSON.parse(row.file_patterns),
    enabled: row.enabled === 1,
    sourceHash: row.source_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRule(row: RawRuleRow): ReviewRule {
  return {
    id: row.id,
    slug: row.slug ?? null,
    name: row.name,
    description: row.description,
    category: row.category as ReviewRule["category"],
    severity: row.severity as ReviewRule["severity"],
    enabled: row.enabled === 1,
    sourceHash: row.source_hash ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
