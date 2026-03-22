import { Database } from "bun:sqlite";

interface Migration {
  version: number;
  description: string;
  up: string[] | ((db: Database) => void);
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
  {
    version: 3,
    description: "Add reviewer profiles system and fallbackProfile config",
    up: [
      `INSERT OR IGNORE INTO config (key, value) VALUES ('fallbackProfile', 'general')`,
    ],
  },
  {
    version: 4,
    description: "Add slug and source_hash to rules, create rule_updates table",
    up: (db: Database) => {
      // Add columns if they don't already exist (schema.ts may have created them for fresh DBs)
      const columns = db.query("PRAGMA table_info(rules)").all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((c) => c.name));
      if (!columnNames.has("slug")) {
        db.run("ALTER TABLE rules ADD COLUMN slug TEXT");
      }
      if (!columnNames.has("source_hash")) {
        db.run("ALTER TABLE rules ADD COLUMN source_hash TEXT");
      }
      // Backfill slugs from existing rule names (approximate — seeder corrects on first run)
      db.run(`UPDATE rules SET slug = LOWER(REPLACE(REPLACE(REPLACE(name, ' ', '-'), '.', ''), '''', '')) WHERE slug IS NULL`);
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_slug ON rules(slug) WHERE slug IS NOT NULL`);
      db.run(`CREATE TABLE IF NOT EXISTS rule_updates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id     INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
        new_hash    TEXT NOT NULL,
        new_content TEXT NOT NULL,
        dismissed   INTEGER NOT NULL DEFAULT 0,
        detected_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    },
  },
  {
    version: 5,
    description: "Add human review snapshot and threaded comment tables",
    up: [
      `CREATE TABLE IF NOT EXISTS change_snapshots (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        base_branch    TEXT NOT NULL,
        head_sha       TEXT NOT NULL,
        merge_base_sha TEXT NOT NULL,
        diff_hash      TEXT NOT NULL,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS change_snapshot_files (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES change_snapshots(id) ON DELETE CASCADE,
        path        TEXT NOT NULL,
        status      TEXT NOT NULL,
        additions   INTEGER NOT NULL DEFAULT 0,
        deletions   INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS comment_threads (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id     INTEGER NOT NULL REFERENCES change_snapshots(id) ON DELETE CASCADE,
        file_path       TEXT NOT NULL,
        anchor_kind     TEXT NOT NULL,
        start_line      INTEGER,
        end_line        INTEGER,
        state           TEXT NOT NULL DEFAULT 'open',
        orphaned_reason TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS comment_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id   INTEGER NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL,
        body        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
];

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.query("SELECT version FROM schema_version").all() as Array<{ version: number }>;
  return new Set(rows.map((r) => r.version));
}

function applyMigration(db: Database, migration: Migration): void {
  if (typeof migration.up === "function") {
    migration.up(db);
  } else {
    for (const sql of migration.up) {
      db.run(sql);
    }
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
