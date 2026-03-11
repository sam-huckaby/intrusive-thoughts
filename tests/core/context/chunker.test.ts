import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { chunkDiff, computeStats } from "../../../src/core/context/chunker";
import { parseDiff } from "../../../src/core/context/git";
import type { ChangedFile } from "../../../src/types";

const FIXTURES = join(import.meta.dir, "../../fixtures/diffs");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("computeStats", () => {
  it("sums additions and deletions", () => {
    const files: ChangedFile[] = [
      { path: "a.ts", status: "modified", additions: 10, deletions: 3 },
      { path: "b.ts", status: "added", additions: 20, deletions: 0 },
    ];
    const stats = computeStats(files);
    expect(stats.totalAdditions).toBe(30);
    expect(stats.totalDeletions).toBe(3);
    expect(stats.filesChanged).toBe(2);
  });

  it("returns zero stats for empty file list", () => {
    const stats = computeStats([]);
    expect(stats.totalAdditions).toBe(0);
    expect(stats.totalDeletions).toBe(0);
    expect(stats.filesChanged).toBe(0);
  });
});

describe("chunkDiff", () => {
  it("returns empty array for empty file list", () => {
    const chunks = chunkDiff([], { maxDiffLines: 100, chunkSize: 5 });
    expect(chunks).toEqual([]);
  });

  it("returns single chunk when diff is small", () => {
    const raw = loadFixture("small-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 10000, chunkSize: 10 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].id).toBe(0);
  });

  it("single chunk contains all files", () => {
    const raw = loadFixture("small-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 10000, chunkSize: 10 });
    expect(chunks[0].files.length).toBe(files.length);
  });

  it("single chunk has correct stats", () => {
    const raw = loadFixture("small-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 10000, chunkSize: 10 });
    const totalAdds = files.reduce((sum, f) => sum + f.file.additions, 0);
    expect(chunks[0].stats.totalAdditions).toBe(totalAdds);
  });

  it("chunks large diff into multiple chunks", () => {
    const raw = loadFixture("large-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 100, chunkSize: 5 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("respects chunk size limit on files per chunk", () => {
    const raw = loadFixture("large-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 100, chunkSize: 5 });
    for (const chunk of chunks) {
      expect(chunk.files.length).toBeLessThanOrEqual(5);
    }
  });

  it("groups files by directory", () => {
    const raw = loadFixture("large-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 100, chunkSize: 50 });
    for (const chunk of chunks) {
      const dirs = new Set(chunk.files.map((f) => {
        const lastSlash = f.path.lastIndexOf("/");
        return lastSlash === -1 ? "." : f.path.substring(0, lastSlash);
      }));
      // Each chunk should contain files from at most one directory
      expect(dirs.size).toBe(1);
    }
  });

  it("assigns sequential chunk IDs", () => {
    const raw = loadFixture("large-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 100, chunkSize: 3 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].id).toBe(i);
    }
  });

  it("each chunk has non-empty diff content", () => {
    const raw = loadFixture("large-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 100, chunkSize: 5 });
    for (const chunk of chunks) {
      expect(chunk.diff.length).toBeGreaterThan(0);
    }
  });

  it("chunk stats reflect only files in that chunk", () => {
    const raw = loadFixture("large-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 100, chunkSize: 5 });
    for (const chunk of chunks) {
      const expected = computeStats(chunk.files);
      expect(chunk.stats).toEqual(expected);
    }
  });

  it("preserves file order within chunks", () => {
    const raw = loadFixture("small-diff.txt");
    const files = parseDiff(raw);
    const chunks = chunkDiff(files, { maxDiffLines: 10000, chunkSize: 10 });
    const chunkPaths = chunks[0].files.map((f) => f.path);
    const originalPaths = files.map((f) => f.file.path);
    expect(chunkPaths).toEqual(originalPaths);
  });
});
