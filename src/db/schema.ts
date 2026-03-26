import { Database } from "bun:sqlite";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    severity    TEXT NOT NULL DEFAULT 'warning',
    enabled     INTEGER NOT NULL DEFAULT 1,
    source_hash TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    task_summary   TEXT NOT NULL,
    base_branch    TEXT NOT NULL,
    verdict        TEXT NOT NULL,
    result_json    TEXT NOT NULL,
    files_reviewed TEXT NOT NULL,
    provider       TEXT NOT NULL,
    model          TEXT NOT NULL,
    chunks_used    INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS reviewer_profiles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    prompt        TEXT NOT NULL,
    file_patterns TEXT NOT NULL DEFAULT '["**/*"]',
    enabled       INTEGER NOT NULL DEFAULT 1,
    source_hash   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS profile_rules (
    profile_id  INTEGER NOT NULL REFERENCES reviewer_profiles(id) ON DELETE CASCADE,
    rule_id     INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    PRIMARY KEY (profile_id, rule_id)
  )`,
  `CREATE TABLE IF NOT EXISTS profile_updates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id    INTEGER NOT NULL REFERENCES reviewer_profiles(id) ON DELETE CASCADE,
    new_hash      TEXT NOT NULL,
    new_content   TEXT NOT NULL,
    dismissed     INTEGER NOT NULL DEFAULT 0,
    detected_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
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
];

/**
 * Creates all tables if they don't exist.
 * Called by openDatabase() — idempotent.
 * @sideeffect Writes to database
 */
export function applySchema(db: Database): void {
  for (const sql of TABLES) {
    db.run(sql);
  }
}
