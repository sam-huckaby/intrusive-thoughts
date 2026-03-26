import { Database } from "bun:sqlite";
import { ConfigError } from "../../types";
import type { RepoContext } from "../context/repo";

export interface SnapshotFileContent {
  snapshotId: number;
  path: string;
  content: string;
}

export function getSnapshotFileContent(
  db: Database,
  repoContext: RepoContext,
  snapshotId: number,
  requestedPath: string,
): SnapshotFileContent {
  const snapshot = getSnapshotRow(db, snapshotId);
  const path = normalizeRepoPath(requestedPath);
  if (!path) throw new ConfigError("File path is required");
  const proc = Bun.spawnSync({
    cmd: ["git", "show", `${snapshot.head_sha}:${path}`],
    cwd: repoContext.root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    throw new ConfigError(`Unable to read snapshot file ${path}${stderr ? `: ${stderr}` : ""}`);
  }
  return {
    snapshotId,
    path,
    content: new TextDecoder().decode(proc.stdout),
  };
}

interface SnapshotRow {
  id: number;
  head_sha: string;
}

function getSnapshotRow(db: Database, snapshotId: number): SnapshotRow {
  const row = db.query("SELECT id, head_sha FROM change_snapshots WHERE id = ?").get(snapshotId) as SnapshotRow | null;
  if (!row) throw new ConfigError(`Snapshot ${snapshotId} not found`);
  return row;
}

function normalizeRepoPath(requestedPath: string): string {
  const normalized = requestedPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  if (!normalized || normalized === ".") return "";
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new ConfigError(`Invalid repo path: ${requestedPath}`);
  }
  return normalized;
}
