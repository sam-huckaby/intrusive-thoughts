import { Database } from "bun:sqlite";
import { getDefaultRules } from "../core/rules/defaults";

/**
 * Seeds default rules into the database if no rules exist yet.
 * Idempotent — skips if rules table already has rows.
 * @sideeffect Writes to database
 */
export function seedDefaultRules(db: Database): void {
  const count = countExistingRules(db);
  if (count > 0) return;
  insertDefaultRules(db);
}

function countExistingRules(db: Database): number {
  const row = db.query("SELECT COUNT(*) as count FROM rules").get() as { count: number };
  return row.count;
}

function insertDefaultRules(db: Database): void {
  const stmt = db.prepare(
    "INSERT INTO rules (name, description, category, severity) VALUES (?, ?, ?, ?)",
  );
  for (const rule of getDefaultRules()) {
    stmt.run(rule.name, rule.description, rule.category, rule.severity);
  }
}
