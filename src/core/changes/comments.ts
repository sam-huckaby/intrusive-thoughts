import { Database } from "bun:sqlite";
import type {
  CommentAuthorType,
  CommentMessage,
  CommentThread,
  CommentThreadAnchorKind,
  CommentThreadState,
} from "../../types";
import { ConfigError } from "../../types";
import { getSnapshotFileDiff } from "./diff";
import type { RepoContext } from "../context/repo";

export interface CommentThreadWithMessages extends CommentThread {
  messages: CommentMessage[];
}

export interface PromptCommentContext {
  userComments: CommentThreadWithMessages[];
  orphanedUserComments: CommentThreadWithMessages[];
}

export interface CreateCommentThreadInput {
  snapshotId: number;
  filePath: string;
  anchorKind: CommentThreadAnchorKind;
  startLine: number | null;
  endLine: number | null;
  body: string;
}

export interface UpdateCommentThreadInput {
  state?: CommentThreadState;
  orphanedReason?: string | null;
}

export function listSnapshotThreads(
  db: Database,
  snapshotId: number,
  filePath?: string,
): CommentThreadWithMessages[] {
  assertSnapshotExists(db, snapshotId);
  const normalizedPath = filePath ? normalizeRepoPath(filePath) : undefined;
  const rows = normalizedPath
    ? db.query(
      `SELECT * FROM comment_threads
       WHERE snapshot_id = ? AND file_path = ?
       ORDER BY id ASC`,
    ).all(snapshotId, normalizedPath)
    : db.query(
      `SELECT * FROM comment_threads
       WHERE snapshot_id = ?
       ORDER BY id ASC`,
    ).all(snapshotId);

  return (rows as CommentThreadRow[]).map((row) => ({
    ...rowToCommentThread(row),
    messages: listThreadMessages(db, row.id),
  }));
}

export function createCommentThread(
  db: Database,
  input: CreateCommentThreadInput,
): CommentThreadWithMessages {
  assertSnapshotExists(db, input.snapshotId);
  const filePath = normalizeRepoPath(input.filePath);
  validateThreadAnchor(input.anchorKind, input.startLine, input.endLine);
  const body = input.body.trim();
  if (!body) throw new ConfigError("Thread body is required");

  const result = db.run(
    `INSERT INTO comment_threads (snapshot_id, file_path, anchor_kind, start_line, end_line)
     VALUES (?, ?, ?, ?, ?)`,
    [input.snapshotId, filePath, input.anchorKind, input.startLine, input.endLine],
  );
  const threadId = Number(result.lastInsertRowid);
  db.run(
    `INSERT INTO comment_messages (thread_id, author_type, body)
     VALUES (?, ?, ?)`,
    [threadId, "user", body],
  );
  return getThreadById(db, threadId);
}

export function addThreadMessage(
  db: Database,
  threadId: number,
  authorType: CommentAuthorType,
  body: string,
): CommentThreadWithMessages {
  const thread = getThreadRow(db, threadId);
  const trimmed = body.trim();
  if (!trimmed) throw new ConfigError("Message body is required");
  db.run(
    `INSERT INTO comment_messages (thread_id, author_type, body)
     VALUES (?, ?, ?)`,
    [thread.id, authorType, trimmed],
  );
  db.run(
    `UPDATE comment_threads SET updated_at = datetime('now') WHERE id = ?`,
    [thread.id],
  );
  return getThreadById(db, thread.id);
}

export function updateThread(
  db: Database,
  threadId: number,
  input: UpdateCommentThreadInput,
): CommentThreadWithMessages {
  const thread = getThreadRow(db, threadId);
  const clauses: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.state !== undefined) {
    clauses.push("state = ?");
    values.push(input.state);
  }
  if (input.orphanedReason !== undefined) {
    clauses.push("orphaned_reason = ?");
    values.push(input.orphanedReason);
  }
  if (clauses.length === 0) {
    throw new ConfigError("No thread updates provided");
  }

  db.run(
    `UPDATE comment_threads SET ${clauses.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...values, thread.id],
  );
  return getThreadById(db, thread.id);
}

export function getPromptCommentContext(
  db: Database,
  baseBranch: string,
  headSha: string,
): PromptCommentContext {
  const snapshot = db.query(
    `SELECT id FROM change_snapshots
     WHERE base_branch = ? AND head_sha = ?
     ORDER BY id DESC
     LIMIT 1`,
  ).get(baseBranch, headSha) as { id: number } | null;

  if (!snapshot) {
    return { userComments: [], orphanedUserComments: [] };
  }

  const threads = listSnapshotThreads(db, snapshot.id);
  return {
    userComments: threads.filter((thread) => thread.state === "open"),
    orphanedUserComments: listOrphanedThreadsForSnapshot(db, snapshot.id),
  };
}

export function listOrphanedThreadsForSnapshot(
  db: Database,
  snapshotId: number,
  filePath?: string,
): CommentThreadWithMessages[] {
  assertSnapshotExists(db, snapshotId);
  const normalizedPath = filePath ? normalizeRepoPath(filePath) : undefined;
  const rows = normalizedPath
    ? db.query(
      `SELECT * FROM comment_threads
       WHERE state = 'orphaned' AND snapshot_id != ? AND file_path = ?
       ORDER BY updated_at DESC, id ASC`,
    ).all(snapshotId, normalizedPath)
    : db.query(
      `SELECT * FROM comment_threads
       WHERE state = 'orphaned' AND snapshot_id != ?
       ORDER BY updated_at DESC, id ASC`,
    ).all(snapshotId);

  return (rows as CommentThreadRow[]).map((row) => ({
    ...rowToCommentThread(row),
    messages: listThreadMessages(db, row.id),
  }));
}

export function reconcileOpenThreadsAgainstSnapshot(
  db: Database,
  repoContext: RepoContext,
  snapshotId: number,
): void {
  assertSnapshotExists(db, snapshotId);
  const openRows = db.query(
    `SELECT * FROM comment_threads
     WHERE state = 'open' AND snapshot_id != ?
     ORDER BY id ASC`,
  ).all(snapshotId) as CommentThreadRow[];

  for (const row of openRows) {
    const thread = rowToCommentThread(row);
    if (!isFileChangedInSnapshot(db, snapshotId, thread.filePath)) {
      markThreadOrphaned(db, thread.id, "Referenced change no longer appears in diff");
      continue;
    }
    if (thread.anchorKind === "file") {
      continue;
    }
    const diff = getSnapshotFileDiff(db, repoContext, snapshotId, thread.filePath).diff;
    if (!diff || !threadAnchorExistsInDiff(thread, diff)) {
      markThreadOrphaned(db, thread.id, "Anchor no longer maps after later edits");
    }
  }
}

function isFileChangedInSnapshot(db: Database, snapshotId: number, filePath: string): boolean {
  const row = db.query(
    "SELECT 1 FROM change_snapshot_files WHERE snapshot_id = ? AND path = ? LIMIT 1",
  ).get(snapshotId, filePath);
  return Boolean(row);
}

function threadAnchorExistsInDiff(thread: CommentThread, diff: NonNullable<ReturnType<typeof getSnapshotFileDiff>["diff"]>): boolean {
  const newLines = new Set<number>();
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.newLineNumber !== null) {
        newLines.add(line.newLineNumber);
      }
    }
  }

  if (thread.anchorKind === "line") {
    return thread.startLine !== null && newLines.has(thread.startLine);
  }
  if (thread.anchorKind === "range") {
    if (thread.startLine === null || thread.endLine === null) return false;
    for (let line = thread.startLine; line <= thread.endLine; line++) {
      if (!newLines.has(line)) return false;
    }
    return true;
  }
  return true;
}

function markThreadOrphaned(db: Database, threadId: number, reason: string): void {
  db.run(
    `UPDATE comment_threads
     SET state = 'orphaned', orphaned_reason = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [reason, threadId],
  );
}

function getThreadById(db: Database, threadId: number): CommentThreadWithMessages {
  const row = getThreadRow(db, threadId);
  return {
    ...rowToCommentThread(row),
    messages: listThreadMessages(db, threadId),
  };
}

function listThreadMessages(db: Database, threadId: number): CommentMessage[] {
  const rows = db.query(
    `SELECT * FROM comment_messages WHERE thread_id = ? ORDER BY id ASC`,
  ).all(threadId) as CommentMessageRow[];
  return rows.map(rowToCommentMessage);
}

function getThreadRow(db: Database, threadId: number): CommentThreadRow {
  const row = db.query("SELECT * FROM comment_threads WHERE id = ?").get(threadId) as CommentThreadRow | null;
  if (!row) throw new ConfigError(`Thread ${threadId} not found`);
  return row;
}

function assertSnapshotExists(db: Database, snapshotId: number): void {
  const row = db.query("SELECT id FROM change_snapshots WHERE id = ?").get(snapshotId);
  if (!row) throw new ConfigError(`Snapshot ${snapshotId} not found`);
}

function validateThreadAnchor(
  anchorKind: CommentThreadAnchorKind,
  startLine: number | null,
  endLine: number | null,
): void {
  if (anchorKind === "file") {
    if (startLine !== null || endLine !== null) {
      throw new ConfigError("File-level threads cannot include line anchors");
    }
    return;
  }

  if (startLine === null) {
    throw new ConfigError("Line and range threads require startLine");
  }
  if (anchorKind === "line") {
    if (endLine !== null && endLine !== startLine) {
      throw new ConfigError("Line threads cannot span multiple lines");
    }
    return;
  }

  if (endLine === null || endLine < startLine) {
    throw new ConfigError("Range threads require endLine >= startLine");
  }
}

function normalizeRepoPath(requestedPath: string): string {
  const normalized = requestedPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  if (!normalized || normalized === ".") throw new ConfigError("File path is required");
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new ConfigError(`Invalid repo path: ${requestedPath}`);
  }
  return normalized;
}

interface CommentThreadRow {
  id: number;
  snapshot_id: number;
  file_path: string;
  anchor_kind: CommentThreadAnchorKind;
  start_line: number | null;
  end_line: number | null;
  state: CommentThreadState;
  orphaned_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentMessageRow {
  id: number;
  thread_id: number;
  author_type: CommentAuthorType;
  body: string;
  created_at: string;
}

function rowToCommentThread(row: CommentThreadRow): CommentThread {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    filePath: row.file_path,
    anchorKind: row.anchor_kind,
    startLine: row.start_line,
    endLine: row.end_line,
    state: row.state,
    orphanedReason: row.orphaned_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCommentMessage(row: CommentMessageRow): CommentMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorType: row.author_type,
    body: row.body,
    createdAt: row.created_at,
  };
}
