import { beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { createTestDb } from "../../db/helpers";
import { getCurrentSnapshotState } from "../../../src/core/changes/snapshots";
import {
  addThreadMessage,
  createCommentThread,
  getPromptCommentContext,
  listSnapshotThreads,
  listOrphanedThreadsForSnapshot,
  reconcileOpenThreadsAgainstSnapshot,
  updateThread,
} from "../../../src/core/changes/comments";

let db: Database;
let snapshotId: number;

beforeEach(async () => {
  db = createTestDb();
  const state = await getCurrentSnapshotState(db, { root: process.cwd() });
  snapshotId = state.snapshot.id;
});

describe("comment threads", () => {
  it("creates a user-rooted thread with initial message", () => {
    const thread = createCommentThread(db, {
      snapshotId,
      filePath: "README.md",
      anchorKind: "file",
      startLine: null,
      endLine: null,
      body: "Please clarify the setup instructions.",
    });
    expect(thread.filePath).toBe("README.md");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].authorType).toBe("user");
  });

  it("adds replies to an existing thread", () => {
    const thread = createCommentThread(db, {
      snapshotId,
      filePath: "README.md",
      anchorKind: "file",
      startLine: null,
      endLine: null,
      body: "Please clarify the setup instructions.",
    });
    const updated = addThreadMessage(db, thread.id, "agent", "Can you clarify which step is confusing?");
    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1].authorType).toBe("agent");
  });

  it("lists threads with nested messages", () => {
    const thread = createCommentThread(db, {
      snapshotId,
      filePath: "README.md",
      anchorKind: "line",
      startLine: 3,
      endLine: 3,
      body: "This line should mention Bun explicitly.",
    });
    addThreadMessage(db, thread.id, "user", "Specifically in the prerequisites section.");
    const threads = listSnapshotThreads(db, snapshotId, "README.md");
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it("updates thread state and orphaned reason", () => {
    const thread = createCommentThread(db, {
      snapshotId,
      filePath: "README.md",
      anchorKind: "range",
      startLine: 3,
      endLine: 5,
      body: "This section looks stale.",
    });
    const updated = updateThread(db, thread.id, {
      state: "orphaned",
      orphanedReason: "Change appears reverted",
    });
    expect(updated.state).toBe("orphaned");
    expect(updated.orphanedReason).toBe("Change appears reverted");
  });

  it("reconciles stale open threads into orphaned threads when file disappears from the diff", () => {
    db.run(
      "INSERT INTO change_snapshots (base_branch, head_sha, merge_base_sha, diff_hash) VALUES (?, ?, ?, ?)",
      ["main", "stale-head", "stale-base", "stale-diff"],
    );
    const staleSnapshot = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    const thread = createCommentThread(db, {
      snapshotId: staleSnapshot.id,
      filePath: "missing/file.ts",
      anchorKind: "file",
      startLine: null,
      endLine: null,
      body: "This change still needs work.",
    });

    reconcileOpenThreadsAgainstSnapshot(db, { root: process.cwd() }, snapshotId);

    const orphaned = listOrphanedThreadsForSnapshot(db, snapshotId);
    expect(orphaned.some((item) => item.id === thread.id)).toBe(true);
    expect(orphaned[0].orphanedReason).toContain("no longer appears in diff");
  });

  it("separates active and orphaned comments for prompt context", () => {
    createCommentThread(db, {
      snapshotId,
      filePath: "README.md",
      anchorKind: "file",
      startLine: null,
      endLine: null,
      body: "Active instruction",
    });
    db.run(
      "INSERT INTO change_snapshots (base_branch, head_sha, merge_base_sha, diff_hash) VALUES (?, ?, ?, ?)",
      ["main", "older-head", "older-base", "older-diff"],
    );
    const oldSnapshot = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    const orphaned = createCommentThread(db, {
      snapshotId: oldSnapshot.id,
      filePath: "stale/file.ts",
      anchorKind: "file",
      startLine: null,
      endLine: null,
      body: "Old instruction",
    });
    updateThread(db, orphaned.id, { state: "orphaned", orphanedReason: "Change appears reverted" });

    const context = getPromptCommentContext(db, "main", process.env.GIT_HEAD_OVERRIDE ?? (db.query("SELECT head_sha FROM change_snapshots WHERE id = ?").get(snapshotId) as { head_sha: string }).head_sha);
    expect(context.userComments).toHaveLength(1);
    expect(context.orphanedUserComments).toHaveLength(1);
    expect(context.userComments[0].messages[0].body).toBe("Active instruction");
    expect(context.orphanedUserComments[0].messages[0].body).toBe("Old instruction");
  });
});
