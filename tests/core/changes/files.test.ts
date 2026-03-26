import { describe, it, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTestDb } from "../../db/helpers";
import { getCurrentSnapshotState } from "../../../src/core/changes/snapshots";
import { getSnapshotFileContent } from "../../../src/core/changes/files";

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

describe("getSnapshotFileContent", () => {
  it("reads a tracked file from snapshot HEAD", async () => {
    const state = await getCurrentSnapshotState(db, { root: process.cwd() });
    const result = getSnapshotFileContent(db, { root: process.cwd() }, state.snapshot.id, "README.md");
    expect(result.path).toBe("README.md");
    expect(result.content).toContain("# intrusive-thoughts");
  });
});
