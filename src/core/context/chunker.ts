import type { ChangedFile, DiffChunk, DiffStats } from "../../types";

export interface ChunkerOptions {
  maxDiffLines: number;
  chunkSize: number;
}

interface FileWithDiff {
  file: ChangedFile;
  diffSection: string;
}

/**
 * Splits a list of changed files and their diffs into chunks.
 * If total diff lines <= maxDiffLines, returns a single chunk.
 * Otherwise, groups files by directory and caps each chunk at chunkSize files.
 * Pure function — no I/O.
 */
export function chunkDiff(
  files: FileWithDiff[],
  options: ChunkerOptions,
): DiffChunk[] {
  if (files.length === 0) return [];
  const totalLines = countTotalLines(files);
  if (totalLines <= options.maxDiffLines) return [buildSingleChunk(files)];
  return buildGroupedChunks(files, options.chunkSize);
}

/**
 * Computes DiffStats for a subset of files.
 * Pure function — used internally by chunkDiff and available for tests.
 */
export function computeStats(files: ChangedFile[]): DiffStats {
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }
  return { totalAdditions, totalDeletions, filesChanged: files.length };
}

function countTotalLines(files: FileWithDiff[]): number {
  let total = 0;
  for (const f of files) {
    total += f.diffSection.split("\n").length;
  }
  return total;
}

function buildSingleChunk(files: FileWithDiff[]): DiffChunk {
  const changedFiles = files.map((f) => f.file);
  const diff = files.map((f) => f.diffSection).join("\n");
  return { id: 0, files: changedFiles, diff, stats: computeStats(changedFiles) };
}

function buildGroupedChunks(files: FileWithDiff[], chunkSize: number): DiffChunk[] {
  const groups = groupByDirectory(files);
  const chunks: DiffChunk[] = [];
  let chunkId = 0;
  for (const group of groups) {
    const subChunks = splitGroup(group, chunkSize, chunkId);
    chunks.push(...subChunks);
    chunkId += subChunks.length;
  }
  return chunks;
}

function groupByDirectory(files: FileWithDiff[]): FileWithDiff[][] {
  const map = new Map<string, FileWithDiff[]>();
  for (const f of files) {
    const dir = extractParentDir(f.file.path);
    const group = map.get(dir) ?? [];
    group.push(f);
    map.set(dir, group);
  }
  return Array.from(map.values());
}

function extractParentDir(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? "." : filePath.substring(0, lastSlash);
}

function splitGroup(
  group: FileWithDiff[],
  chunkSize: number,
  startId: number,
): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  for (let i = 0; i < group.length; i += chunkSize) {
    const slice = group.slice(i, i + chunkSize);
    const changedFiles = slice.map((f) => f.file);
    const diff = slice.map((f) => f.diffSection).join("\n");
    chunks.push({
      id: startId + chunks.length,
      files: changedFiles,
      diff,
      stats: computeStats(changedFiles),
    });
  }
  return chunks;
}
