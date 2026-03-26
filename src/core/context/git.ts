import type { ChangedFile, DiffStats } from "../../types";
import { GitError } from "../../types";

export interface GitDiffResult {
  diff: string;
  files: ChangedFile[];
  stats: DiffStats;
}

interface ParsedFile {
  file: ChangedFile;
  diffSection: string;
}

/**
 * Runs `git diff <baseBranch>...HEAD` in the given directory.
 * Parses the output into structured file list, stats, and raw diff.
 * @sideeffect Runs git subprocess
 * @throws {GitError} if not a git repo, branch doesn't exist, or git fails
 */
export async function getGitDiff(
  workingDirectory: string,
  baseBranch: string,
): Promise<GitDiffResult> {
  const raw = await fetchRawDiff(workingDirectory, baseBranch);
  const parsed = parseDiff(raw);
  const files = parsed.map((p) => p.file);
  return { diff: raw, files, stats: computeStatsFromFiles(files) };
}

async function fetchRawDiff(dir: string, base: string): Promise<string> {
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", "diff", `${base}...HEAD`],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      const stderr = new TextDecoder().decode(proc.stderr).trim();
      throw new Error(stderr || `git exited with code ${proc.exitCode}`);
    }
    return new TextDecoder().decode(proc.stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GitError(`Git diff failed: ${msg}`, `git diff ${base}...HEAD`);
  }
}

function computeStatsFromFiles(files: ChangedFile[]): DiffStats {
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }
  return { totalAdditions, totalDeletions, filesChanged: files.length };
}

/**
 * Parses a raw unified diff string into per-file sections.
 * Pure function — no I/O. Used by both getGitDiff and tests with fixtures.
 * Returns one entry per file in the diff, preserving order.
 */
export function parseDiff(rawDiff: string): ParsedFile[] {
  if (!rawDiff.trim()) return [];
  const sections = splitIntoFileSections(rawDiff);
  return sections.map(parseFileSection);
}

function splitIntoFileSections(rawDiff: string): string[] {
  const parts = rawDiff.split(/^(?=diff --git )/m);
  return parts.filter((p) => p.trim().length > 0);
}

function parseFileSection(section: string): ParsedFile {
  const filePath = extractFilePath(section);
  const status = detectFileStatus(section);
  const counts = countAdditionsDeletions(section);
  return {
    file: { path: filePath, status, ...counts },
    diffSection: section,
  };
}

function extractFilePath(section: string): string {
  const renameMatch = section.match(/^rename to (.+)$/m);
  if (renameMatch) return renameMatch[1];
  const bMatch = section.match(/^\+\+\+ b\/(.+)$/m);
  if (bMatch) return bMatch[1];
  const headerMatch = section.match(/^diff --git a\/.+ b\/(.+)$/m);
  return headerMatch ? headerMatch[1] : "unknown";
}

function detectFileStatus(section: string): ChangedFile["status"] {
  if (section.includes("new file mode")) return "added";
  if (section.includes("deleted file mode")) return "deleted";
  if (section.includes("rename from")) return "renamed";
  return "modified";
}

function countAdditionsDeletions(section: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const lines = section.split("\n");
  for (const line of lines) {
    if (isHunkHeader(line)) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

function isHunkHeader(line: string): boolean {
  return line.startsWith("@@");
}
