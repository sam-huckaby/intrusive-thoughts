import { Database } from "bun:sqlite";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { parseRuleFile } from "../core/rules/frontmatter";
import type { ParsedRule } from "../core/rules/frontmatter";

/**
 * Scans the `prompts/rules/` directory and seeds new rules into the DB.
 * For existing rules, detects when the on-disk file has changed and records
 * a notification in `rule_updates`.
 *
 * This is idempotent and safe to call on every startup.
 * @sideeffect Reads filesystem, writes to database
 */
export async function seedRules(
  db: Database,
  rulesDir: string,
): Promise<void> {
  const files = await listRuleFiles(rulesDir);
  for (const filename of files) {
    const filePath = join(rulesDir, filename);
    const content = await readFile(filePath, "utf-8");
    const parsed = parseRuleFile(content, filename);
    const existing = getExistingRule(db, parsed.slug);

    if (!existing) {
      insertRule(db, parsed);
    } else {
      detectRuleUpdate(db, existing, parsed);
    }
  }
}

async function listRuleFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith(".md")).sort();
  } catch {
    // Directory doesn't exist — no rules to seed
    return [];
  }
}

interface ExistingRule {
  id: number;
  slug: string;
  sourceHash: string | null;
}

function getExistingRule(db: Database, slug: string): ExistingRule | null {
  const row = db.query(
    "SELECT id, slug, source_hash FROM rules WHERE slug = ?",
  ).get(slug) as { id: number; slug: string; source_hash: string | null } | null;

  if (!row) return null;
  return { id: row.id, slug: row.slug, sourceHash: row.source_hash };
}

function insertRule(db: Database, parsed: ParsedRule): void {
  db.run(
    `INSERT INTO rules (slug, name, description, category, severity, source_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      parsed.slug,
      parsed.name,
      parsed.description,
      parsed.category,
      parsed.severity,
      parsed.contentHash,
    ],
  );
}

/**
 * Detects when an on-disk rule file has changed relative to what's in the DB.
 * If changed, inserts a notification into `rule_updates` (unless an identical
 * undismissed notification already exists).
 */
function detectRuleUpdate(
  db: Database,
  existing: ExistingRule,
  parsed: ParsedRule,
): void {
  // Same hash — no change
  if (existing.sourceHash === parsed.contentHash) return;

  // Check if an undismissed update with this hash already exists
  const existingUpdate = db.query(
    `SELECT id FROM rule_updates
     WHERE rule_id = ? AND new_hash = ? AND dismissed = 0`,
  ).get(existing.id, parsed.contentHash) as { id: number } | null;

  if (existingUpdate) return;

  // Record the update notification
  const newContent = JSON.stringify({
    name: parsed.name,
    description: parsed.description,
    category: parsed.category,
    severity: parsed.severity,
  });
  db.run(
    `INSERT INTO rule_updates (rule_id, new_hash, new_content)
     VALUES (?, ?, ?)`,
    [existing.id, parsed.contentHash, newContent],
  );
}
