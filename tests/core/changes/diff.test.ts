import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseStructuredDiff } from "../../../src/core/changes/diff";

const FIXTURES = join(import.meta.dir, "../../fixtures/diffs");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("parseStructuredDiff", () => {
  it("parses file diffs and hunks", () => {
    const result = parseStructuredDiff(loadFixture("single-file.txt"));
    expect(result.length).toBe(1);
    expect(result[0].path).toBe("src/config.ts");
    expect(result[0].hunks.length).toBeGreaterThan(0);
  });

  it("assigns line numbers for additions and deletions", () => {
    const result = parseStructuredDiff(loadFixture("single-file.txt"));
    const lines = result[0].hunks[0].lines;
    expect(lines.some((line) => line.type === "add" && line.newLineNumber !== null)).toBe(true);
    expect(lines.some((line) => line.type === "delete" && line.oldLineNumber !== null)).toBe(true);
  });

  it("returns no hunks for binary diffs", () => {
    const result = parseStructuredDiff(loadFixture("binary-files.txt"));
    expect(result[0].isBinary).toBe(true);
    expect(result[0].hunks).toEqual([]);
  });
});
