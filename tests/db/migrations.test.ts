import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema";
import { runMigrations } from "../../src/db/migrations";

function freshDb(): Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

describe("runMigrations", () => {
  it("seeds default config values on first run", () => {
    const db = freshDb();
    runMigrations(db);
    const rows = db.query("SELECT key, value FROM config").all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    expect(map.get("provider")).toBe("anthropic");
    expect(map.get("model")).toBe("claude-sonnet-4-20250514");
    expect(map.get("baseBranch")).toBe("main");
    expect(map.get("maxDiffLines")).toBe("5000");
    expect(map.get("chunkSize")).toBe("10");
    expect(map.get("httpPort")).toBe("3456");
  });

  it("is idempotent — running twice does not duplicate config", () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    const rows = db.query("SELECT key, value FROM config WHERE key = 'provider'").all();
    expect(rows.length).toBe(1);
  });

  it("tracks applied versions in schema_version", () => {
    const db = freshDb();
    runMigrations(db);
    const rows = db.query("SELECT version FROM schema_version").all() as Array<{ version: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].version).toBe(1);
  });

  it("skips already-applied migrations", () => {
    const db = freshDb();
    runMigrations(db);
    const before = db.query("SELECT version FROM schema_version").all();
    runMigrations(db);
    const after = db.query("SELECT version FROM schema_version").all();
    expect(after.length).toBe(before.length);
  });

  it("records applied_at timestamp", () => {
    const db = freshDb();
    runMigrations(db);
    const row = db.query("SELECT applied_at FROM schema_version WHERE version = 1").get() as { applied_at: string };
    expect(row.applied_at).toBeTruthy();
  });

  it("migration v3 seeds fallbackProfile config key", () => {
    const db = freshDb();
    runMigrations(db);
    const row = db.query("SELECT value FROM config WHERE key = 'fallbackProfile'").get() as { value: string } | null;
    expect(row).not.toBeNull();
    expect(row!.value).toBe("general");
  });

  it("migration v3 is recorded in schema_version", () => {
    const db = freshDb();
    runMigrations(db);
    const row = db.query("SELECT version FROM schema_version WHERE version = 3").get() as { version: number } | null;
    expect(row).not.toBeNull();
    expect(row!.version).toBe(3);
  });

  it("all migrations are applied", () => {
    const db = freshDb();
    runMigrations(db);
    const rows = db.query("SELECT version FROM schema_version ORDER BY version").all() as Array<{ version: number }>;
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  it("migration v4 adds slug and source_hash columns to rules", () => {
    const db = freshDb();
    runMigrations(db);
    // Insert a rule to verify new columns exist and accept values
    db.run(
      "INSERT INTO rules (slug, name, description, category, severity, source_hash) VALUES (?, ?, ?, ?, ?, ?)",
      ["test-rule", "Test Rule", "A test", "general", "warning", "abc123"],
    );
    const row = db.query("SELECT slug, source_hash FROM rules WHERE slug = ?").get("test-rule") as { slug: string; source_hash: string };
    expect(row.slug).toBe("test-rule");
    expect(row.source_hash).toBe("abc123");
  });

  it("migration v4 backfills slugs for existing rules", () => {
    const db = freshDb();
    // Insert a rule before running migrations so v4 backfills it
    db.run(
      "INSERT INTO rules (name, description, category, severity) VALUES (?, ?, ?, ?)",
      ["No magic numbers", "Desc", "general", "warning"],
    );
    runMigrations(db);
    const row = db.query("SELECT slug FROM rules WHERE name = ?").get("No magic numbers") as { slug: string };
    expect(row.slug).toBe("no-magic-numbers");
  });

  it("migration v4 creates rule_updates table", () => {
    const db = freshDb();
    runMigrations(db);
    // Insert into rule_updates to prove the table exists
    db.run(
      "INSERT INTO rules (slug, name, description) VALUES (?, ?, ?)",
      ["r1", "R1", "Desc"],
    );
    const rule = db.query("SELECT id FROM rules WHERE slug = ?").get("r1") as { id: number };
    db.run(
      "INSERT INTO rule_updates (rule_id, new_hash, new_content) VALUES (?, ?, ?)",
      [rule.id, "hash123", '{"name":"Updated"}'],
    );
    const update = db.query("SELECT * FROM rule_updates WHERE rule_id = ?").get(rule.id) as { new_hash: string; dismissed: number };
    expect(update.new_hash).toBe("hash123");
    expect(update.dismissed).toBe(0);
  });

  it("migration v4 enforces unique slug index", () => {
    const db = freshDb();
    runMigrations(db);
    db.run("INSERT INTO rules (slug, name, description) VALUES (?, ?, ?)", ["unique-slug", "Rule 1", "Desc"]);
    expect(() => {
      db.run("INSERT INTO rules (slug, name, description) VALUES (?, ?, ?)", ["unique-slug", "Rule 2", "Desc"]);
    }).toThrow();
  });
});
