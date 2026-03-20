import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema";
import { runMigrations } from "../../src/db/migrations";

/**
 * Creates a fresh in-memory SQLite database with schema applied
 * and migrations run. Use this in every test that needs a DB.
 */
export function createTestDb(): Database {
  const db = new Database(":memory:");
  applySchema(db);
  runMigrations(db);
  return db;
}

/**
 * Synchronously inserts the 5 default rules into the DB.
 * Replacement for the old `seedDefaultRules()` — used by tests that need
 * rules present without async file I/O.
 */
export function seedTestRules(db: Database): void {
  const rules = [
    { slug: "no-code-duplication", name: "No code duplication", description: "Flag repeated logic that should be extracted into shared functions or utilities.", category: "maintainability", severity: "warning" },
    { slug: "no-hardcoded-colors", name: "No hardcoded colors", description: "Color values must reference theme tokens, CSS variables, or a design system — never raw hex/rgb literals.", category: "style", severity: "warning" },
    { slug: "no-magic-numbers", name: "No magic numbers", description: "Numeric literals should be named constants with descriptive names explaining their purpose.", category: "maintainability", severity: "suggestion" },
    { slug: "error-handling-required", name: "Error handling required", description: "All async operations and external calls must have proper error handling (try/catch or .catch).", category: "security", severity: "critical" },
    { slug: "no-console-log", name: "No console.log in production code", description: "Remove console.log statements; use a proper logging framework or remove debug output.", category: "style", severity: "suggestion" },
  ];
  const stmt = db.prepare(
    "INSERT INTO rules (slug, name, description, category, severity) VALUES (?, ?, ?, ?, ?)",
  );
  for (const r of rules) {
    stmt.run(r.slug, r.name, r.description, r.category, r.severity);
  }
}
