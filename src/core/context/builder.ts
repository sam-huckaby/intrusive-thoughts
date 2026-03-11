import type { ReviewContext, ReviewRule } from "../../types";
import type { GitDiffResult } from "./git";

export interface BuildContextInput {
  taskSummary: string;
  baseBranch: string;
  workingDirectory: string;
  gitResult: GitDiffResult;
  rules: ReviewRule[];
}

/**
 * Assembles a complete ReviewContext from all inputs.
 * Pure function — no I/O, no database access.
 */
export function buildReviewContext(input: BuildContextInput): ReviewContext {
  return {
    taskSummary: input.taskSummary,
    baseBranch: input.baseBranch,
    workingDirectory: input.workingDirectory,
    changedFiles: input.gitResult.files,
    diff: input.gitResult.diff,
    stats: input.gitResult.stats,
    rules: input.rules,
  };
}
