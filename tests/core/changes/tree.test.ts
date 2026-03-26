import { describe, it, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTestDb } from "../../db/helpers";
import { getCurrentSnapshotState } from "../../../src/core/changes/snapshots";
import { getSnapshotTree, parseLsTreeOutput } from "../../../src/core/changes/tree";

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

describe("getSnapshotTree", () => {
  it("returns top-level tracked entries from snapshot HEAD", async () => {
    const state = await getCurrentSnapshotState(db, { root: process.cwd() });
    const tree = getSnapshotTree(db, { root: process.cwd() }, state.snapshot.id);
    expect(tree.nodes.length).toBeGreaterThan(0);
    expect(tree.nodes.some((node) => node.name === "src")).toBe(true);
  });

  it("marks directories with changed descendants", async () => {
    const state = await getCurrentSnapshotState(db, { root: process.cwd() });
    db.run(
      "INSERT INTO change_snapshot_files (snapshot_id, path, status, additions, deletions) VALUES (?, ?, ?, ?, ?)",
      [state.snapshot.id, "src/index.ts", "modified", 3, 1],
    );
    const tree = getSnapshotTree(db, { root: process.cwd() }, state.snapshot.id);
    const node = tree.nodes.find((entry) => entry.name === "src");
    expect(node).toBeTruthy();
    expect(node!.hasChangedDescendants || node!.changed).toBe(true);
  });
});

describe("parseLsTreeOutput", () => {
  it("parses submodule entries as commit objects", () => {
    const entries = parseLsTreeOutput("160000 commit abcdef1234567890abcdef1234567890abcdef12\tvendor/submodule\n");
    expect(entries[0].mode).toBe("160000");
    expect(entries[0].type).toBe("commit");
    expect(entries[0].name).toBe("vendor/submodule");
  });
});
