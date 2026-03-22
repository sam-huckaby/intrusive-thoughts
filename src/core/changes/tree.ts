import { Database } from "bun:sqlite";
import type { ChangeSnapshotFileStatus } from "../../types";
import { ConfigError } from "../../types";
import type { RepoContext } from "../context/repo";

export interface ChangeTreeNode {
  path: string;
  name: string;
  kind: "file" | "directory" | "submodule";
  expandable: boolean;
  changed: boolean;
  changeStatus: ChangeSnapshotFileStatus | null;
  hasChangedDescendants: boolean;
}

export interface ChangeTreeResponse {
  snapshotId: number;
  path: string;
  nodes: ChangeTreeNode[];
}

export function getSnapshotTree(
  db: Database,
  repoContext: RepoContext,
  snapshotId: number,
  requestedPath?: string,
): ChangeTreeResponse {
  const snapshot = getSnapshotRow(db, snapshotId);
  const path = normalizeRepoPath(requestedPath);
  const objectSpec = path ? `${snapshot.head_sha}:${path}` : snapshot.head_sha;
  const output = runGitCommand(repoContext.root, ["ls-tree", objectSpec]);
  const changedFiles = getChangedFiles(db, snapshotId);
  const nodes = parseLsTreeOutput(output).map((entry) => toTreeNode(entry, changedFiles));
  return {
    snapshotId,
    path,
    nodes,
  };
}

interface LsTreeEntry {
  mode: string;
  type: string;
  object: string;
  name: string;
  path: string;
}

interface SnapshotRow {
  id: number;
  head_sha: string;
}

export function parseLsTreeOutput(output: string, parentPath = ""): LsTreeEntry[] {
  if (!output.trim()) return [];
  return output
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => parseLsTreeLine(line, parentPath));
}

function parseLsTreeLine(line: string, parentPath: string): LsTreeEntry {
  const match = line.match(/^(\d{6})\s+(\w+)\s+([0-9a-f]+)\t(.+)$/);
  if (!match) {
    throw new ConfigError(`Unparseable git ls-tree line: ${line}`);
  }
  const [, mode, type, object, name] = match;
  const path = parentPath ? `${parentPath}/${name}` : name;
  return { mode, type, object, name, path };
}

function toTreeNode(entry: LsTreeEntry, changedFiles: Map<string, ChangeSnapshotFileStatus>): ChangeTreeNode {
  const isSubmodule = entry.mode === "160000" || entry.type === "commit";
  const kind: ChangeTreeNode["kind"] = isSubmodule
    ? "submodule"
    : entry.type === "tree"
      ? "directory"
      : "file";
  const directStatus = changedFiles.get(entry.path) ?? null;
  const hasChangedDescendants = kind === "directory"
    ? Array.from(changedFiles.keys()).some((path) => path.startsWith(`${entry.path}/`))
    : false;
  return {
    path: entry.path,
    name: entry.name,
    kind,
    expandable: kind === "directory",
    changed: directStatus !== null,
    changeStatus: directStatus,
    hasChangedDescendants,
  };
}

function getSnapshotRow(db: Database, snapshotId: number): SnapshotRow {
  const row = db.query("SELECT id, head_sha FROM change_snapshots WHERE id = ?").get(snapshotId) as SnapshotRow | null;
  if (!row) throw new ConfigError(`Snapshot ${snapshotId} not found`);
  return row;
}

function getChangedFiles(db: Database, snapshotId: number): Map<string, ChangeSnapshotFileStatus> {
  const rows = db.query(
    "SELECT path, status FROM change_snapshot_files WHERE snapshot_id = ?",
  ).all(snapshotId) as Array<{ path: string; status: ChangeSnapshotFileStatus }>;
  return new Map(rows.map((row) => [row.path, row.status]));
}

function normalizeRepoPath(requestedPath?: string): string {
  if (!requestedPath) return "";
  const normalized = requestedPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  if (!normalized || normalized === ".") return "";
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new ConfigError(`Invalid repo path: ${requestedPath}`);
  }
  return normalized;
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
    throw new ConfigError(`Git command failed: git ${args.join(" ")}${stderr ? `: ${stderr}` : ""}`);
  }
  return new TextDecoder().decode(proc.stdout);
}
