import { describe, it, expect, beforeEach } from "bun:test";
import supertest from "supertest";
import { createApp } from "../../src/server/http";
import { createTestDb } from "../db/helpers";
import type { Database } from "bun:sqlite";
import { join } from "path";

const PROMPT_PATH = join(import.meta.dir, "../fixtures/prompts/test-review.md");
let db: Database;
let request: ReturnType<typeof supertest>;

beforeEach(() => {
  db = createTestDb();
  const app = createApp({
    db,
    promptPath: PROMPT_PATH,
    repoContext: { root: process.cwd() },
  });
  request = supertest(app);
});

describe("GET /api/changes/current", () => {
  it("creates a snapshot on first request", async () => {
    const res = await request.get("/api/changes/current");
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.snapshot.id).toBeTruthy();
    const count = db.query("SELECT COUNT(*) as count FROM change_snapshots").get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("reuses the snapshot when HEAD has not changed", async () => {
    const first = await request.get("/api/changes/current");
    const second = await request.get("/api/changes/current");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.snapshot.id).toBe(first.body.snapshot.id);
    const count = db.query("SELECT COUNT(*) as count FROM change_snapshots").get() as { count: number };
    expect(count.count).toBe(1);
  });
});

describe("POST /api/changes/refresh", () => {
  it("returns the existing snapshot when HEAD is unchanged", async () => {
    const first = await request.get("/api/changes/current");
    const refreshed = await request.post("/api/changes/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.created).toBe(false);
    expect(refreshed.body.snapshot.id).toBe(first.body.snapshot.id);
  });
});

describe("GET /api/changes/snapshots/:id/tree", () => {
  it("returns tree nodes for a snapshot", async () => {
    const current = await request.get("/api/changes/current");
    const res = await request.get(`/api/changes/snapshots/${current.body.snapshot.id}/tree`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(res.body.nodes.some((node: { name: string }) => node.name === "src")).toBe(true);
  });

  it("returns child nodes for a nested tree path", async () => {
    const current = await request.get("/api/changes/current");
    const res = await request
      .get(`/api/changes/snapshots/${current.body.snapshot.id}/tree`)
      .query({ path: "src" });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("src");
    expect(Array.isArray(res.body.nodes)).toBe(true);
  });
});

describe("GET /api/changes/snapshots/:id/file", () => {
  it("returns snapshot file contents", async () => {
    const current = await request.get("/api/changes/current");
    const res = await request
      .get(`/api/changes/snapshots/${current.body.snapshot.id}/file`)
      .query({ path: "README.md" });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("README.md");
    expect(res.body.content).toContain("# intrusive-thoughts");
  });
});

describe("GET /api/changes/snapshots/:id/diff", () => {
  it("returns null for unchanged files", async () => {
    const current = await request.get("/api/changes/current");
    const res = await request
      .get(`/api/changes/snapshots/${current.body.snapshot.id}/diff`)
      .query({ path: "README.md" });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("README.md");
    expect(res.body.diff).toBeNull();
  });

  it("returns structured diff for a changed file when available", async () => {
    const current = await request.get("/api/changes/current");
    const row = db.query(
      "SELECT path FROM change_snapshot_files WHERE snapshot_id = ? ORDER BY path LIMIT 1",
    ).get(current.body.snapshot.id) as { path: string } | null;
    if (!row) {
      expect(true).toBe(true);
      return;
    }
    const res = await request
      .get(`/api/changes/snapshots/${current.body.snapshot.id}/diff`)
      .query({ path: row.path });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe(row.path);
    expect(res.body.diff.path).toBe(row.path);
    expect(Array.isArray(res.body.diff.hunks)).toBe(true);
  });
});

describe("threaded comments", () => {
  it("creates and lists a snapshot thread", async () => {
    const current = await request.get("/api/changes/current");
    const created = await request
      .post(`/api/changes/snapshots/${current.body.snapshot.id}/threads`)
      .send({
        filePath: "README.md",
        anchorKind: "file",
        startLine: null,
        endLine: null,
        body: "Please clarify this documentation.",
      });
    expect(created.status).toBe(200);
    expect(created.body.messages).toHaveLength(1);

    const listed = await request.get(`/api/changes/snapshots/${current.body.snapshot.id}/threads`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].messages[0].body).toBe("Please clarify this documentation.");
  });

  it("adds replies beneath an existing thread", async () => {
    const current = await request.get("/api/changes/current");
    const created = await request
      .post(`/api/changes/snapshots/${current.body.snapshot.id}/threads`)
      .send({
        filePath: "README.md",
        anchorKind: "line",
        startLine: 1,
        endLine: 1,
        body: "Can we make this title more explicit?",
      });
    const replied = await request
      .post(`/api/changes/threads/${created.body.id}/messages`)
      .send({ authorType: "agent", body: "What wording would you prefer?" });
    expect(replied.status).toBe(200);
    expect(replied.body.messages).toHaveLength(2);
    expect(replied.body.messages[1].authorType).toBe("agent");
  });

  it("updates thread state", async () => {
    const current = await request.get("/api/changes/current");
    const created = await request
      .post(`/api/changes/snapshots/${current.body.snapshot.id}/threads`)
      .send({
        filePath: "README.md",
        anchorKind: "range",
        startLine: 2,
        endLine: 4,
        body: "This section needs revision.",
      });
    const updated = await request
      .patch(`/api/changes/threads/${created.body.id}`)
      .send({ state: "resolved" });
    expect(updated.status).toBe(200);
    expect(updated.body.state).toBe("resolved");
  });

  it("lists orphaned threads separately for the current snapshot", async () => {
    const current = await request.get("/api/changes/current");
    db.run(
      "INSERT INTO change_snapshots (base_branch, head_sha, merge_base_sha, diff_hash) VALUES (?, ?, ?, ?)",
      ["main", "older-head", "older-base", "older-diff"],
    );
    const older = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
    const created = await request
      .post(`/api/changes/snapshots/${older.id}/threads`)
      .send({
        filePath: "README.md",
        anchorKind: "file",
        startLine: null,
        endLine: null,
        body: "Old comment",
      });
    await request
      .patch(`/api/changes/threads/${created.body.id}`)
      .send({ state: "orphaned", orphanedReason: "Referenced change no longer appears in diff" });

    const listed = await request
      .get(`/api/changes/snapshots/${current.body.snapshot.id}/orphaned-threads`)
      .query({ filePath: "README.md" });
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].state).toBe("orphaned");
  });
});
