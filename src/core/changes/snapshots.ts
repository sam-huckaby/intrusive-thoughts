import { Database } from "bun:sqlite";
import type { ChangeSnapshot } from "../../types";
import { ConfigError } from "../../types";
import { loadAppConfig } from "../config";
import { getGitDiff } from "../context/git";
import type { RepoContext } from "../context/repo";
import { reconcileOpenThreadsAgainstSnapshot } from "./comments";

export interface SnapshotState {
  repoRoot: string;
  baseBranch: string;
  headSha: string;
  snapshot: ChangeSnapshot;
  created: boolean;
}

export async function getCurrentSnapshotState(
  db: Database,
  repoContext: RepoContext,
): Promise<SnapshotState> {
  return ensureSnapshotState(db, repoContext);
}

export function getSnapshotHeadSha(repoRoot: string): string {
  return runGitCommand(repoRoot, ["rev-parse", "HEAD"]);
}

export async function refreshSnapshotState(
  db: Database,
  repoContext: RepoContext,
): Promise<SnapshotState> {
  return ensureSnapshotState(db, repoContext);
}

async function ensureSnapshotState(
  db: Database,
  repoContext: RepoContext,
): Promise<SnapshotState> {
  const config = loadAppConfig(db);
  const headSha = await getHeadSha(repoContext.root);
  const existing = getSnapshotByHead(db, config.baseBranch, headSha);
  if (existing) {
    return {
      repoRoot: repoContext.root,
      baseBranch: config.baseBranch,
      headSha,
      snapshot: existing,
      created: false,
    };
  }

  const mergeBaseSha = await getMergeBaseSha(repoContext.root, config.baseBranch);
  const gitResult = await getGitDiff(repoContext.root, config.baseBranch);
  const diffHash = await hashDiff(gitResult.diff);
  const snapshotId = insertSnapshot(db, {
    baseBranch: config.baseBranch,
    headSha,
    mergeBaseSha,
    diffHash,
  });
  insertSnapshotFiles(db, snapshotId, gitResult.files);
  reconcileOpenThreadsAgainstSnapshot(db, repoContext, snapshotId);
  const snapshot = getSnapshotById(db, snapshotId);
  return {
    repoRoot: repoContext.root,
    baseBranch: config.baseBranch,
    headSha,
    snapshot,
    created: true,
  };
}

function getSnapshotByHead(db: Database, baseBranch: string, headSha: string): ChangeSnapshot | null {
  const row = db.query(
    `SELECT id, base_branch, head_sha, merge_base_sha, diff_hash, created_at
     FROM change_snapshots
     WHERE base_branch = ? AND head_sha = ?
     ORDER BY id DESC
     LIMIT 1`,
  ).get(baseBranch, headSha) as SnapshotRow | null;
  return row ? rowToSnapshot(row) : null;
}

function getSnapshotById(db: Database, id: number): ChangeSnapshot {
  const row = db.query(
    `SELECT id, base_branch, head_sha, merge_base_sha, diff_hash, created_at
     FROM change_snapshots WHERE id = ?`,
  ).get(id) as SnapshotRow | null;
  if (!row) {
    throw new ConfigError(`Missing snapshot ${id}`);
  }
  return rowToSnapshot(row);
}

function insertSnapshot(
  db: Database,
  input: { baseBranch: string; headSha: string; mergeBaseSha: string; diffHash: string },
): number {
  const result = db.run(
    `INSERT INTO change_snapshots (base_branch, head_sha, merge_base_sha, diff_hash)
     VALUES (?, ?, ?, ?)`,
    [input.baseBranch, input.headSha, input.mergeBaseSha, input.diffHash],
  );
  return Number(result.lastInsertRowid);
}

function insertSnapshotFiles(
  db: Database,
  snapshotId: number,
  files: Array<{ path: string; status: string; additions: number; deletions: number }>,
): void {
  const stmt = db.prepare(
    `INSERT INTO change_snapshot_files (snapshot_id, path, status, additions, deletions)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const file of files) {
    stmt.run(snapshotId, file.path, file.status, file.additions, file.deletions);
  }
}

async function getHeadSha(repoRoot: string): Promise<string> {
  return getSnapshotHeadSha(repoRoot);
}

async function getMergeBaseSha(repoRoot: string, baseBranch: string): Promise<string> {
  return runGitCommand(repoRoot, ["merge-base", baseBranch, "HEAD"]);
}

async function hashDiff(diff: string): Promise<string> {
  const bytes = new TextEncoder().encode(diff);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function runGitCommand(repoRoot: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    throw new ConfigError(
      `Git command failed: git ${args.join(" ")}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

interface SnapshotRow {
  id: number;
  base_branch: string;
  head_sha: string;
  merge_base_sha: string;
  diff_hash: string;
  created_at: string;
}

function rowToSnapshot(row: SnapshotRow): ChangeSnapshot {
  return {
    id: row.id,
    baseBranch: row.base_branch,
    headSha: row.head_sha,
    mergeBaseSha: row.merge_base_sha,
    diffHash: row.diff_hash,
    createdAt: row.created_at,
  };
}
