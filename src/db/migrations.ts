import { Database } from "bun:sqlite";

interface Migration {
  version: number;
  description: string;
  up: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Seed default config values",
    up: [
      `INSERT OR IGNORE INTO config (key, value) VALUES ('provider', 'anthropic')`,
      `INSERT OR IGNORE INTO config (key, value) VALUES ('model', 'claude-sonnet-4-20250514')`,
      `INSERT OR IGNORE INTO config (key, value) VALUES ('baseBranch', 'main')`,
      `INSERT OR IGNORE INTO config (key, value) VALUES ('maxDiffLines', '5000')`,
      `INSERT OR IGNORE INTO config (key, value) VALUES ('chunkSize', '10')`,
      `INSERT OR IGNORE INTO config (key, value) VALUES ('httpPort', '3456')`,
    ],
  },
  {
    version: 2,
    description: "Add maxReviewRounds config default",
    up: [
      `INSERT OR IGNORE INTO config (key, value) VALUES ('maxReviewRounds', '5')`,
    ],
  },
];

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.query("SELECT version FROM schema_version").all() as Array<{ version: number }>;
  return new Set(rows.map((r) => r.version));
}

function applyMigration(db: Database, migration: Migration): void {
  for (const sql of migration.up) {
    db.run(sql);
  }
  db.run(
    "INSERT INTO schema_version (version) VALUES (?)",
    [migration.version],
  );
}

/**
 * Runs all pending migrations in order.
 * Tracks applied versions in the schema_version table.
 * Called by openDatabase() after applySchema().
 * @sideeffect Writes to database
 */
export function runMigrations(db: Database): void {
  const applied = getAppliedVersions(db);
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  for (const migration of pending) {
    applyMigration(db, migration);
  }
}
