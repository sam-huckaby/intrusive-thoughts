import type { ChangedFile, EvalFixture, ReviewContext, ReviewRule } from "../../types";

export interface BuildEvalContextInput {
  taskSummary: string;
  fixtures: EvalFixture[];
  rules: ReviewRule[];
}

export function buildEvalReviewContext(input: BuildEvalContextInput): ReviewContext {
  const changedFiles = input.fixtures.map(toChangedFile);
  return {
    taskSummary: input.taskSummary,
    baseBranch: "eval-fixtures",
    workingDirectory: process.cwd(),
    changedFiles,
    diff: buildSyntheticDiff(input.fixtures),
    stats: {
      filesChanged: changedFiles.length,
      totalAdditions: changedFiles.reduce((sum, file) => sum + file.additions, 0),
      totalDeletions: 0,
    },
    rules: input.rules,
  };
}

function toChangedFile(fixture: EvalFixture): ChangedFile {
  return {
    path: fixture.fileName,
    status: "added",
    additions: countLines(fixture.code),
    deletions: 0,
  };
}

function buildSyntheticDiff(fixtures: EvalFixture[]): string {
  return fixtures.map((fixture) => buildFixtureDiff(fixture)).join("\n\n");
}

function buildFixtureDiff(fixture: EvalFixture): string {
  const lines = fixture.code.split(/\r?\n/);
  const additions = lines.map((line) => `+${line}`);
  return [
    `diff --git a/${fixture.fileName} b/${fixture.fileName}`,
    "new file mode 100644",
    "index 0000000..eval000",
    "--- /dev/null",
    `+++ b/${fixture.fileName}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    ...additions,
  ].join("\n");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}
