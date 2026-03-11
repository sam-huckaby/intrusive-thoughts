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
});
