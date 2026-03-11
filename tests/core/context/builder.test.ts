import { describe, it, expect } from "bun:test";
import { buildReviewContext } from "../../../src/core/context/builder";
import type { ReviewRule } from "../../../src/types";
import type { GitDiffResult } from "../../../src/core/context/git";

function makeGitResult(overrides?: Partial<GitDiffResult>): GitDiffResult {
  return {
    diff: "diff --git a/test.ts b/test.ts\n+added line",
    files: [
      { path: "test.ts", status: "modified", additions: 1, deletions: 0 },
    ],
    stats: { totalAdditions: 1, totalDeletions: 0, filesChanged: 1 },
    ...overrides,
  };
}

function makeRule(overrides?: Partial<ReviewRule>): ReviewRule {
  return {
    id: 1,
    name: "Test rule",
    description: "A test rule",
    category: "general",
    severity: "warning",
    enabled: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildReviewContext", () => {
  it("assembles full context with all fields", () => {
    const rules = [makeRule()];
    const gitResult = makeGitResult();
    const context = buildReviewContext({
      taskSummary: "Add user auth",
      baseBranch: "main",
      workingDirectory: "/repo",
      gitResult,
      rules,
    });
    expect(context.taskSummary).toBe("Add user auth");
    expect(context.baseBranch).toBe("main");
    expect(context.workingDirectory).toBe("/repo");
    expect(context.changedFiles).toEqual(gitResult.files);
    expect(context.diff).toBe(gitResult.diff);
    expect(context.stats).toEqual(gitResult.stats);
    expect(context.rules).toEqual(rules);
  });

  it("includes only provided rules", () => {
    const rules = [makeRule({ id: 1 }), makeRule({ id: 2, name: "Second" })];
    const context = buildReviewContext({
      taskSummary: "test",
      baseBranch: "main",
      workingDirectory: "/repo",
      gitResult: makeGitResult(),
      rules,
    });
    expect(context.rules.length).toBe(2);
  });

  it("handles zero rules", () => {
    const context = buildReviewContext({
      taskSummary: "test",
      baseBranch: "main",
      workingDirectory: "/repo",
      gitResult: makeGitResult(),
      rules: [],
    });
    expect(context.rules).toEqual([]);
  });

  it("handles empty diff", () => {
    const context = buildReviewContext({
      taskSummary: "test",
      baseBranch: "main",
      workingDirectory: "/repo",
      gitResult: makeGitResult({
        diff: "",
        files: [],
        stats: { totalAdditions: 0, totalDeletions: 0, filesChanged: 0 },
      }),
      rules: [],
    });
    expect(context.diff).toBe("");
    expect(context.changedFiles).toEqual([]);
    expect(context.stats.filesChanged).toBe(0);
  });
});
