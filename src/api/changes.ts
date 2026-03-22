import { Router } from "express";
import { Database } from "bun:sqlite";
import { z } from "zod";
import type { RepoContext } from "../core/context/repo";
import { getCurrentSnapshotState, refreshSnapshotState } from "../core/changes/snapshots";
import { getSnapshotTree } from "../core/changes/tree";
import { getSnapshotFileContent } from "../core/changes/files";
import { getSnapshotFileDiff } from "../core/changes/diff";
import { addThreadMessage, createCommentThread, listOrphanedThreadsForSnapshot, listSnapshotThreads, updateThread } from "../core/changes/comments";

const TreeQuerySchema = z.object({
  path: z.string().optional(),
});

const FileQuerySchema = z.object({
  path: z.string().min(1),
});

const DiffQuerySchema = z.object({
  path: z.string().min(1),
});

const ThreadsQuerySchema = z.object({
  filePath: z.string().optional(),
});

const CreateThreadSchema = z.object({
  filePath: z.string().min(1),
  anchorKind: z.enum(["file", "line", "range"]),
  startLine: z.number().int().positive().nullable().default(null),
  endLine: z.number().int().positive().nullable().default(null),
  body: z.string().min(1),
});

const CreateMessageSchema = z.object({
  authorType: z.enum(["user", "agent"]),
  body: z.string().min(1),
});

const UpdateThreadSchema = z.object({
  state: z.enum(["open", "resolved", "orphaned"]).optional(),
  orphanedReason: z.string().nullable().optional(),
});

type Res = {
  json: (body: unknown) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

export function createChangesRouter(db: Database, repoContext: RepoContext | null): Router {
  const router = Router();
  router.get("/current", async (_req, res) => {
    if (!repoContext) {
      res.status(503).json({ error: "Changes workspace is unavailable without an active repo context" });
      return;
    }
    try {
      res.json(await getCurrentSnapshotState(db, repoContext));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
  router.post("/refresh", async (_req, res) => {
    if (!repoContext) {
      res.status(503).json({ error: "Changes workspace is unavailable without an active repo context" });
      return;
    }
    try {
      res.json(await refreshSnapshotState(db, repoContext));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
  router.get("/snapshots/:id/tree", (req, res) => {
    if (!repoContext) {
      res.status(503).json({ error: "Changes workspace is unavailable without an active repo context" });
      return;
    }
    const parsed = TreeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const snapshotId = Number(req.params.id);
      res.json(getSnapshotTree(db, repoContext, snapshotId, parsed.data.path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
  router.get("/snapshots/:id/file", (req, res) => {
    if (!repoContext) {
      res.status(503).json({ error: "Changes workspace is unavailable without an active repo context" });
      return;
    }
    const parsed = FileQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const snapshotId = Number(req.params.id);
      res.json(getSnapshotFileContent(db, repoContext, snapshotId, parsed.data.path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
  router.get("/snapshots/:id/diff", (req, res) => {
    if (!repoContext) {
      res.status(503).json({ error: "Changes workspace is unavailable without an active repo context" });
      return;
    }
    const parsed = DiffQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const snapshotId = Number(req.params.id);
      res.json(getSnapshotFileDiff(db, repoContext, snapshotId, parsed.data.path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
  router.get("/snapshots/:id/threads", (req, res) => {
    const parsed = ThreadsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const snapshotId = Number(req.params.id);
      res.json(listSnapshotThreads(db, snapshotId, parsed.data.filePath));
    } catch (err) {
      handleApiError(err, res);
    }
  });
  router.get("/snapshots/:id/orphaned-threads", (req, res) => {
    const parsed = ThreadsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const snapshotId = Number(req.params.id);
      res.json(listOrphanedThreadsForSnapshot(db, snapshotId, parsed.data.filePath));
    } catch (err) {
      handleApiError(err, res);
    }
  });
  router.post("/snapshots/:id/threads", (req, res) => {
    const parsed = CreateThreadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const snapshotId = Number(req.params.id);
      res.json(createCommentThread(db, { snapshotId, ...parsed.data }));
    } catch (err) {
      handleApiError(err, res);
    }
  });
  router.post("/threads/:id/messages", (req, res) => {
    const parsed = CreateMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const threadId = Number(req.params.id);
      res.json(addThreadMessage(db, threadId, parsed.data.authorType, parsed.data.body));
    } catch (err) {
      handleApiError(err, res);
    }
  });
  router.patch("/threads/:id", (req, res) => {
    const parsed = UpdateThreadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const threadId = Number(req.params.id);
      res.json(updateThread(db, threadId, parsed.data));
    } catch (err) {
      handleApiError(err, res);
    }
  });
  return router;
}

function handleApiError(err: unknown, res: Res): void {
  const msg = err instanceof Error ? err.message : String(err);
  const status = msg.includes("not found") || msg.includes("Invalid") ? 404 : 400;
  res.status(status).json({ error: msg });
}
