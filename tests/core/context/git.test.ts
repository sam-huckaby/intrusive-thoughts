import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDiff } from "../../../src/core/context/git";

const FIXTURES = join(import.meta.dir, "../../fixtures/diffs");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("parseDiff", () => {
  it("parses a simple 3-file diff", () => {
    const raw = loadFixture("small-diff.txt");
    const result = parseDiff(raw);
    expect(result.length).toBe(3);
  });

  it("extracts correct file paths", () => {
    const raw = loadFixture("small-diff.txt");
    const result = parseDiff(raw);
    const paths = result.map((r) => r.file.path);
    expect(paths).toContain("src/utils/format.ts");
    expect(paths).toContain("src/utils/validate.ts");
    expect(paths).toContain("src/index.ts");
  });

  it("detects new file status", () => {
    const raw = loadFixture("small-diff.txt");
    const result = parseDiff(raw);
    const validate = result.find((r) => r.file.path === "src/utils/validate.ts");
    expect(validate).toBeTruthy();
    expect(validate!.file.status).toBe("added");
  });

  it("detects modified file status", () => {
    const raw = loadFixture("small-diff.txt");
    const result = parseDiff(raw);
    const format = result.find((r) => r.file.path === "src/utils/format.ts");
    expect(format).toBeTruthy();
    expect(format!.file.status).toBe("modified");
  });

  it("counts additions and deletions accurately", () => {
    const raw = loadFixture("small-diff.txt");
    const result = parseDiff(raw);
    const format = result.find((r) => r.file.path === "src/utils/format.ts");
    expect(format!.file.additions).toBe(4);
    expect(format!.file.deletions).toBe(1);
  });

  it("parses renamed files", () => {
    const raw = loadFixture("renamed-files.txt");
    const result = parseDiff(raw);
    const renamed = result.filter((r) => r.file.status === "renamed");
    expect(renamed.length).toBe(2);
  });

  it("extracts rename target path", () => {
    const raw = loadFixture("renamed-files.txt");
    const result = parseDiff(raw);
    const paths = result.map((r) => r.file.path);
    expect(paths).toContain("src/utils/helpers.ts");
    expect(paths).toContain("src/new-name.ts");
  });

  it("handles binary files without crashing", () => {
    const raw = loadFixture("binary-files.txt");
    const result = parseDiff(raw);
    expect(result.length).toBe(2);
  });

  it("detects new binary file as added", () => {
    const raw = loadFixture("binary-files.txt");
    const result = parseDiff(raw);
    const logo = result.find((r) => r.file.path === "assets/logo.png");
    expect(logo).toBeTruthy();
    expect(logo!.file.status).toBe("added");
  });

  it("returns empty array for empty diff", () => {
    const result = parseDiff("");
    expect(result).toEqual([]);
  });

  it("returns empty array for whitespace-only diff", () => {
    const result = parseDiff("   \n  \n  ");
    expect(result).toEqual([]);
  });

  it("parses single-file diff", () => {
    const raw = loadFixture("single-file.txt");
    const result = parseDiff(raw);
    expect(result.length).toBe(1);
    expect(result[0].file.path).toBe("src/config.ts");
  });

  it("calculates correct stats for single file", () => {
    const raw = loadFixture("single-file.txt");
    const result = parseDiff(raw);
    expect(result[0].file.additions).toBe(3);
    expect(result[0].file.deletions).toBe(1);
  });

  it("preserves diff section content per file", () => {
    const raw = loadFixture("small-diff.txt");
    const result = parseDiff(raw);
    for (const entry of result) {
      expect(entry.diffSection).toContain("diff --git");
    }
  });

  it("parses large diff with 30+ files", () => {
    const raw = loadFixture("large-diff.txt");
    const result = parseDiff(raw);
    expect(result.length).toBeGreaterThanOrEqual(30);
  });
});
