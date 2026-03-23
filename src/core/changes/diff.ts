import { Database } from "bun:sqlite";
import type { StructuredDiffHunk, StructuredDiffLine, StructuredFileDiff } from "../../types";
import { ConfigError } from "../../types";
import type { RepoContext } from "../context/repo";

export interface SnapshotFileDiffResult {
  snapshotId: number;
  path: string;
  diff: StructuredFileDiff | null;
}

export function getSnapshotFileDiff(
  db: Database,
  repoContext: RepoContext,
  snapshotId: number,
  requestedPath: string,
): SnapshotFileDiffResult {
  const snapshot = getSnapshotRow(db, snapshotId);
  const path = normalizeRepoPath(requestedPath);
  if (!path) throw new ConfigError("File path is required");

  const isChanged = db.query(
    "SELECT 1 FROM change_snapshot_files WHERE snapshot_id = ? AND path = ? LIMIT 1",
  ).get(snapshotId, path);
  if (!isChanged) {
    return { snapshotId, path, diff: null };
  }

  const output = runGitCommand(repoContext.root, ["diff", snapshot.merge_base_sha, snapshot.head_sha, "--", path]);
  const diffs = parseStructuredDiff(output);
  return {
    snapshotId,
    path,
    diff: diffs[0] ?? null,
  };
}

export function parseStructuredDiff(rawDiff: string): StructuredFileDiff[] {
  if (!rawDiff.trim()) return [];
  const sections = rawDiff.split(/^(?=diff --git )/m).filter((part) => part.trim().length > 0);
  return sections.map(parseStructuredFileSection);
}

function parseStructuredFileSection(section: string): StructuredFileDiff {
  const path = extractFilePath(section);
  const status = detectFileStatus(section);
  const counts = countAdditionsDeletions(section);
  const isBinary = section.includes("Binary files ");
  return {
    path,
    status,
    additions: counts.additions,
    deletions: counts.deletions,
    isBinary,
    hunks: isBinary ? [] : parseHunks(section),
    diffSection: section,
  };
}

function parseHunks(section: string): StructuredDiffHunk[] {
  const lines = section.split("\n");
  const hunks: StructuredDiffHunk[] = [];
  let current: StructuredDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const header = parseHunkHeader(line);
    if (header) {
      current = {
        header: line,
        oldStart: header.oldStart,
        oldCount: header.oldCount,
        newStart: header.newStart,
        newCount: header.newCount,
        lines: [],
      };
      hunks.push(current);
      oldLine = header.oldStart;
      newLine = header.newStart;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;
    current.lines.push(buildStructuredLine(line, oldLine, newLine));
    const last = current.lines[current.lines.length - 1];
    if (last.type !== "add") oldLine++;
    if (last.type !== "delete") newLine++;
  }

  return hunks;
}

function buildStructuredLine(
  line: string,
  oldLine: number,
  newLine: number,
): StructuredDiffLine {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return {
      type: "add",
      text: line.slice(1),
      oldLineNumber: null,
      newLineNumber: newLine,
    };
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return {
      type: "delete",
      text: line.slice(1),
      oldLineNumber: oldLine,
      newLineNumber: null,
    };
  }
  return {
    type: "context",
    text: line.startsWith(" ") ? line.slice(1) : line,
    oldLineNumber: oldLine,
    newLineNumber: newLine,
  };
}

function parseHunkHeader(line: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? "1"),
  };
}

function extractFilePath(section: string): StructuredFileDiff["path"] {
  const renameMatch = section.match(/^rename to (.+)$/m);
  if (renameMatch) return renameMatch[1];
  const bMatch = section.match(/^\+\+\+ b\/(.+)$/m);
  if (bMatch) return bMatch[1];
  const headerMatch = section.match(/^diff --git a\/.+ b\/(.+)$/m);
  return headerMatch ? headerMatch[1] : "unknown";
}

function detectFileStatus(section: string): StructuredFileDiff["status"] {
  if (section.includes("new file mode")) return "added";
  if (section.includes("deleted file mode")) return "deleted";
  if (section.includes("rename from")) return "renamed";
  return "modified";
}

function countAdditionsDeletions(section: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of section.split("\n")) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

interface SnapshotRow {
  id: number;
  head_sha: string;
  merge_base_sha: string;
}

function getSnapshotRow(db: Database, snapshotId: number): SnapshotRow {
  const row = db.query(
    "SELECT id, head_sha, merge_base_sha FROM change_snapshots WHERE id = ?",
  ).get(snapshotId) as SnapshotRow | null;
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
