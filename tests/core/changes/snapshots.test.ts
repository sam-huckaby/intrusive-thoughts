import { describe, it, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTestDb } from "../../db/helpers";
import { getCurrentSnapshotState, refreshSnapshotState } from "../../../src/core/changes/snapshots";

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

describe("snapshot state", () => {
  it("creates a snapshot on first lookup", async () => {
    const result = await getCurrentSnapshotState(db, { root: process.cwd() });
    expect(result.created).toBe(true);
    expect(result.snapshot.id).toBeGreaterThan(0);
    expect(result.snapshot.headSha).toBe(result.headSha);
    const row = db.query("SELECT COUNT(*) as count FROM change_snapshots").get() as { count: number };
    expect(row.count).toBe(1);
  });

  it("reuses the snapshot when HEAD is unchanged", async () => {
    const first = await getCurrentSnapshotState(db, { root: process.cwd() });
    const second = await getCurrentSnapshotState(db, { root: process.cwd() });
    expect(first.snapshot.id).toBe(second.snapshot.id);
    expect(second.created).toBe(false);
    const row = db.query("SELECT COUNT(*) as count FROM change_snapshots").get() as { count: number };
    expect(row.count).toBe(1);
  });

  it("refresh returns the existing snapshot when HEAD is unchanged", async () => {
    const first = await getCurrentSnapshotState(db, { root: process.cwd() });
    const refreshed = await refreshSnapshotState(db, { root: process.cwd() });
    expect(refreshed.snapshot.id).toBe(first.snapshot.id);
    expect(refreshed.created).toBe(false);
  });

  it("creates a new snapshot when only stale snapshots exist", async () => {
    db.run(
      "INSERT INTO change_snapshots (base_branch, head_sha, merge_base_sha, diff_hash) VALUES (?, ?, ?, ?)",
      ["main", "stale-head", "stale-base", "stale-diff"],
    );
    const result = await getCurrentSnapshotState(db, { root: process.cwd() });
    expect(result.created).toBe(true);
    expect(result.snapshot.headSha).not.toBe("stale-head");
    const row = db.query("SELECT COUNT(*) as count FROM change_snapshots").get() as { count: number };
    expect(row.count).toBe(2);
  });
});
