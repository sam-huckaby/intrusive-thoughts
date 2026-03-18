import { Database } from "bun:sqlite";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parseProfileFile } from "../core/profiles/frontmatter";
import type { ParsedProfile } from "../core/profiles/frontmatter";

/**
 * Scans the `prompts/reviewers/` directory and seeds new profiles into the DB.
 * For existing profiles, detects when the on-disk file has changed and records
 * a notification in `profile_updates`.
 *
 * This is idempotent and safe to call on every startup.
 * @sideeffect Reads filesystem, writes to database
 */
export async function seedProfiles(
  db: Database,
  reviewersDir: string,
): Promise<void> {
  const files = await listProfileFiles(reviewersDir);
  for (const filename of files) {
    const filePath = join(reviewersDir, filename);
    const content = await readFile(filePath, "utf-8");
    const parsed = parseProfileFile(content, filename);
    const existing = getExistingProfile(db, parsed.slug);

    if (!existing) {
      insertProfile(db, parsed);
      linkRulesByName(db, parsed.slug, parsed.rules);
    } else {
      detectProfileUpdate(db, existing, parsed);
    }
  }
}

async function listProfileFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith(".md")).sort();
  } catch {
    // Directory doesn't exist — no profiles to seed
    return [];
  }
}

interface ExistingProfile {
  id: number;
  slug: string;
  sourceHash: string | null;
}

function getExistingProfile(db: Database, slug: string): ExistingProfile | null {
  const row = db.query(
    "SELECT id, slug, source_hash FROM reviewer_profiles WHERE slug = ?",
  ).get(slug) as { id: number; slug: string; source_hash: string | null } | null;

  if (!row) return null;
  return { id: row.id, slug: row.slug, sourceHash: row.source_hash };
}

function insertProfile(db: Database, parsed: ParsedProfile): void {
  db.run(
    `INSERT INTO reviewer_profiles (slug, name, description, prompt, file_patterns, source_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      parsed.slug,
      parsed.name,
      parsed.description,
      parsed.prompt,
      JSON.stringify(parsed.filePatterns),
      parsed.contentHash,
    ],
  );
}

/**
 * Links rules to a profile by matching rule names.
 * Looks up each rule name in the `rules` table and creates a `profile_rules` row.
 * Rules that don't exist in the DB are silently skipped.
 */
function linkRulesByName(db: Database, slug: string, ruleNames: string[]): void {
  if (ruleNames.length === 0) return;

  const profile = db.query(
    "SELECT id FROM reviewer_profiles WHERE slug = ?",
  ).get(slug) as { id: number } | null;
  if (!profile) return;

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO profile_rules (profile_id, rule_id) VALUES (?, ?)",
  );

  for (const name of ruleNames) {
    const rule = db.query(
      "SELECT id FROM rules WHERE name = ?",
    ).get(name) as { id: number } | null;
    if (rule) {
      insertStmt.run(profile.id, rule.id);
    }
  }
}

/**
 * Detects when an on-disk profile file has changed relative to what's in the DB.
 * If changed, inserts a notification into `profile_updates` (unless an identical
 * undismissed notification already exists).
 */
function detectProfileUpdate(
  db: Database,
  existing: ExistingProfile,
  parsed: ParsedProfile,
): void {
  // Same hash — no change
  if (existing.sourceHash === parsed.contentHash) return;

  // Check if an undismissed update with this hash already exists
  const existingUpdate = db.query(
    `SELECT id FROM profile_updates
     WHERE profile_id = ? AND new_hash = ? AND dismissed = 0`,
  ).get(existing.id, parsed.contentHash) as { id: number } | null;

  if (existingUpdate) return;

  // Record the update notification
  db.run(
    `INSERT INTO profile_updates (profile_id, new_hash, new_content)
     VALUES (?, ?, ?)`,
    [existing.id, parsed.contentHash, parsed.prompt],
  );
}
