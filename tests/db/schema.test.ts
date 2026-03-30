import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema";

function getTableNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function getColumns(db: Database, table: string): Array<{ name: string; type: string; notnull: number }> {
  return db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number }>;
}

describe("applySchema", () => {
  it("creates all application tables", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const tables = getTableNames(db);
    expect(tables).toContain("rules");
    expect(tables).toContain("config");
    expect(tables).toContain("reviews");
    expect(tables).toContain("schema_version");
    expect(tables).toContain("reviewer_profiles");
    expect(tables).toContain("profile_rules");
    expect(tables).toContain("profile_updates");
    expect(tables).toContain("change_snapshots");
    expect(tables).toContain("change_snapshot_files");
    expect(tables).toContain("comment_threads");
    expect(tables).toContain("comment_messages");
    expect(tables).toContain("eval_fixtures");
    expect(tables).toContain("eval_expected_findings");
    expect(tables).toContain("eval_runs");
  });

  it("is idempotent — calling twice does not error", () => {
    const db = new Database(":memory:");
    applySchema(db);
    applySchema(db);
    const tables = getTableNames(db);
    expect(tables).toContain("rules");
  });

  it("rules table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "rules");
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("name");
    expect(names).toContain("description");
    expect(names).toContain("category");
    expect(names).toContain("severity");
    expect(names).toContain("enabled");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("rules table enforces NOT NULL on name", () => {
    const db = new Database(":memory:");
    applySchema(db);
    expect(() => {
      db.run("INSERT INTO rules (description) VALUES ('test')");
    }).toThrow();
  });

  it("rules table enforces NOT NULL on description", () => {
    const db = new Database(":memory:");
    applySchema(db);
    expect(() => {
      db.run("INSERT INTO rules (name) VALUES ('test')");
    }).toThrow();
  });

  it("config table has key as primary key", () => {
    const db = new Database(":memory:");
    applySchema(db);
    db.run("INSERT INTO config (key, value) VALUES ('test', 'value')");
    expect(() => {
      db.run("INSERT INTO config (key, value) VALUES ('test', 'other')");
    }).toThrow();
  });

  it("reviews table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "reviews");
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("task_summary");
    expect(names).toContain("base_branch");
    expect(names).toContain("verdict");
    expect(names).toContain("result_json");
    expect(names).toContain("files_reviewed");
    expect(names).toContain("provider");
    expect(names).toContain("model");
    expect(names).toContain("chunks_used");
    expect(names).toContain("created_at");
  });

  it("change_snapshots table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "change_snapshots");
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "base_branch",
      "head_sha",
      "merge_base_sha",
      "diff_hash",
      "created_at",
    ]);
  });

  it("comment_threads table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "comment_threads");
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "snapshot_id",
      "file_path",
      "anchor_kind",
      "start_line",
      "end_line",
      "state",
      "orphaned_reason",
      "created_at",
      "updated_at",
    ]);
  });

  it("comment_messages table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "comment_messages");
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "thread_id",
      "author_type",
      "body",
      "created_at",
    ]);
  });

  it("eval_fixtures table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "eval_fixtures");
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "name",
      "file_name",
      "language",
      "code",
      "notes",
      "created_at",
      "updated_at",
    ]);
  });

  it("eval_expected_findings table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "eval_expected_findings");
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "fixture_id",
      "title",
      "description",
      "severity",
      "line_hint",
      "required",
      "tags_json",
      "created_at",
      "updated_at",
    ]);
  });

  it("eval_runs table has correct columns", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const cols = getColumns(db, "eval_runs");
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      "id",
      "fixture_ids_json",
      "reviewer_slugs_json",
      "reviewer_reports_json",
      "merged_report_json",
      "judge_result_json",
      "judge_provider",
      "judge_model",
      "created_at",
    ]);
  });

  it("rules table defaults enabled to 1", () => {
    const db = new Database(":memory:");
    applySchema(db);
    db.run("INSERT INTO rules (name, description) VALUES ('test', 'desc')");
    const row = db.query("SELECT enabled FROM rules WHERE name = 'test'").get() as { enabled: number };
    expect(row.enabled).toBe(1);
  });

  it("rules table defaults category to general", () => {
    const db = new Database(":memory:");
    applySchema(db);
    db.run("INSERT INTO rules (name, description) VALUES ('test', 'desc')");
    const row = db.query("SELECT category FROM rules WHERE name = 'test'").get() as { category: string };
    expect(row.category).toBe("general");
  });
});
