import { describe, it, expect } from "bun:test";
import { join } from "path";
import {
  loadPromptTemplate,
  interpolatePrompt,
  buildPromptVariables,
  buildChunkPromptVariables,
  formatPreviousReviews,
} from "../../../src/core/reviewer/prompt";
import type { PromptVariables } from "../../../src/core/reviewer/prompt";
import type { ReviewContext, ReviewResult, DiffChunk } from "../../../src/types";

const TEST_PROMPT = join(import.meta.dir, "../../fixtures/prompts/test-review.md");

function makeContext(overrides?: Partial<ReviewContext>): ReviewContext {
  return {
    taskSummary: "Add user auth",
    baseBranch: "main",
    workingDirectory: "/repo",
    changedFiles: [
      { path: "src/auth.ts", status: "added", additions: 50, deletions: 0 },
    ],
    diff: "+export function login() {}",
    stats: { totalAdditions: 50, totalDeletions: 0, filesChanged: 1 },
    rules: [],
    ...overrides,
  };
}

function makeChunk(): DiffChunk {
  return {
    id: 0,
    files: [{ path: "src/auth.ts", status: "added", additions: 50, deletions: 0 }],
    diff: "+export function login() {}",
    stats: { totalAdditions: 50, totalDeletions: 0, filesChanged: 1 },
  };
}

describe("loadPromptTemplate", () => {
  it("loads a template file from disk", async () => {
    const content = await loadPromptTemplate(TEST_PROMPT);
    expect(content).toContain("{{task_summary}}");
    expect(content).toContain("{{rules}}");
    expect(content).toContain("{{diff}}");
  });
});

describe("interpolatePrompt", () => {
  it("replaces all known variables", () => {
    const template = "Task: {{task_summary}} Rules: {{rules}} Diff: {{diff}}";
    const vars: PromptVariables = {
      task_summary: "Test task",
      rules: "Rule 1",
      diff: "+line",
      changed_files: "file.ts",
      stats: "1 file",
      is_chunk: "false",
      chunk_info: "",
      previous_reviews: "",
    };
    const result = interpolatePrompt(template, vars);
    expect(result).toBe("Task: Test task Rules: Rule 1 Diff: +line");
  });

  it("leaves unknown placeholders as-is", () => {
    const template = "{{task_summary}} and {{unknown_var}}";
    const vars: PromptVariables = {
      task_summary: "Test",
      rules: "",
      diff: "",
      changed_files: "",
      stats: "",
      is_chunk: "false",
      chunk_info: "",
      previous_reviews: "",
    };
    const result = interpolatePrompt(template, vars);
    expect(result).toContain("Test");
    expect(result).toContain("{{unknown_var}}");
  });

  it("replaces multiple occurrences of same variable", () => {
    const template = "{{diff}} and also {{diff}}";
    const vars: PromptVariables = {
      task_summary: "",
      rules: "",
      diff: "CONTENT",
      changed_files: "",
      stats: "",
      is_chunk: "false",
      chunk_info: "",
      previous_reviews: "",
    };
    const result = interpolatePrompt(template, vars);
    expect(result).toBe("CONTENT and also CONTENT");
  });
});

describe("buildPromptVariables", () => {
  it("sets is_chunk to false for non-chunked review", () => {
    const vars = buildPromptVariables(makeContext());
    expect(vars.is_chunk).toBe("false");
  });

  it("sets chunk_info to empty for non-chunked review", () => {
    const vars = buildPromptVariables(makeContext());
    expect(vars.chunk_info).toBe("");
  });

  it("includes task summary", () => {
    const vars = buildPromptVariables(makeContext());
    expect(vars.task_summary).toBe("Add user auth");
  });

  it("formats changed files", () => {
    const vars = buildPromptVariables(makeContext());
    expect(vars.changed_files).toContain("src/auth.ts");
    expect(vars.changed_files).toContain("added");
  });

  it("formats stats", () => {
    const vars = buildPromptVariables(makeContext());
    expect(vars.stats).toContain("1 files changed");
    expect(vars.stats).toContain("+50 additions");
  });

  it("returns 'No review rules configured.' when no rules", () => {
    const vars = buildPromptVariables(makeContext({ rules: [] }));
    expect(vars.rules).toBe("No review rules configured.");
  });

  it("includes first-review message when no previous reviews", () => {
    const vars = buildPromptVariables(makeContext());
    expect(vars.previous_reviews).toContain("first review");
  });

  it("includes previous review context when provided", () => {
    const previous: ReviewResult[] = [
      {
        verdict: "request_changes",
        summary: "Fix the auth bug",
        comments: [{ file: "src/auth.ts", line: 10, severity: "critical", comment: "Missing null check" }],
        suggestions: ["Add tests"],
        confidence: 0.9,
      },
    ];
    const vars = buildPromptVariables(makeContext(), previous);
    expect(vars.previous_reviews).toContain("Round 1");
    expect(vars.previous_reviews).toContain("Changes Requested");
    expect(vars.previous_reviews).toContain("Fix the auth bug");
    expect(vars.previous_reviews).toContain("Missing null check");
  });
});

describe("buildChunkPromptVariables", () => {
  it("sets is_chunk to true", () => {
    const vars = buildChunkPromptVariables(makeContext(), makeChunk(), 0, 3);
    expect(vars.is_chunk).toBe("true");
  });

  it("sets chunk_info with correct indices", () => {
    const vars = buildChunkPromptVariables(makeContext(), makeChunk(), 1, 4);
    expect(vars.chunk_info).toBe("Reviewing chunk 2 of 4");
  });

  it("uses chunk diff, not full context diff", () => {
    const chunk = makeChunk();
    chunk.diff = "CHUNK_DIFF_CONTENT";
    const vars = buildChunkPromptVariables(makeContext(), chunk, 0, 1);
    expect(vars.diff).toBe("CHUNK_DIFF_CONTENT");
  });

  it("uses chunk files, not full context files", () => {
    const chunk = makeChunk();
    chunk.files = [{ path: "chunk-file.ts", status: "modified", additions: 5, deletions: 2 }];
    const vars = buildChunkPromptVariables(makeContext(), chunk, 0, 1);
    expect(vars.changed_files).toContain("chunk-file.ts");
  });

  it("includes previous reviews when provided", () => {
    const previous: ReviewResult[] = [
      {
        verdict: "request_changes",
        summary: "Chunk review feedback",
        comments: [],
        suggestions: [],
        confidence: 0.7,
      },
    ];
    const vars = buildChunkPromptVariables(makeContext(), makeChunk(), 0, 1, previous);
    expect(vars.previous_reviews).toContain("Chunk review feedback");
  });
});

describe("formatPreviousReviews", () => {
  it("returns first-review message when undefined", () => {
    const result = formatPreviousReviews(undefined);
    expect(result).toContain("first review");
    expect(result).toContain("No previous reviews");
  });

  it("returns first-review message when empty array", () => {
    const result = formatPreviousReviews([]);
    expect(result).toContain("first review");
  });

  it("formats a single previous review", () => {
    const reviews: ReviewResult[] = [
      {
        verdict: "request_changes",
        summary: "Needs work",
        comments: [
          { file: "src/foo.ts", line: 5, severity: "critical", comment: "Bug here" },
        ],
        suggestions: ["Write tests"],
        confidence: 0.8,
      },
    ];
    const result = formatPreviousReviews(reviews);
    expect(result).toContain("Round 1");
    expect(result).toContain("Changes Requested");
    expect(result).toContain("Needs work");
    expect(result).toContain("src/foo.ts:5");
    expect(result).toContain("Bug here");
    expect(result).toContain("Write tests");
  });

  it("formats multiple previous reviews with round numbers", () => {
    const reviews: ReviewResult[] = [
      {
        verdict: "request_changes",
        summary: "First round feedback",
        comments: [],
        suggestions: [],
        confidence: 0.7,
      },
      {
        verdict: "request_changes",
        summary: "Second round feedback",
        comments: [],
        suggestions: [],
        confidence: 0.8,
      },
    ];
    const result = formatPreviousReviews(reviews);
    expect(result).toContain("Round 1");
    expect(result).toContain("Round 2");
    expect(result).toContain("First round feedback");
    expect(result).toContain("Second round feedback");
  });

  it("shows 'Approved' for approve verdicts", () => {
    const reviews: ReviewResult[] = [
      {
        verdict: "approve",
        summary: "Looks good",
        comments: [],
        suggestions: [],
        confidence: 0.95,
      },
    ];
    const result = formatPreviousReviews(reviews);
    expect(result).toContain("Approved");
    expect(result).not.toContain("Changes Requested");
  });

  it("formats comments without line numbers using file path only", () => {
    const reviews: ReviewResult[] = [
      {
        verdict: "request_changes",
        summary: "Issues found",
        comments: [
          { file: "src/bar.ts", severity: "warning", comment: "General concern" },
        ],
        suggestions: [],
        confidence: 0.8,
      },
    ];
    const result = formatPreviousReviews(reviews);
    expect(result).toContain("src/bar.ts");
    expect(result).toContain("General concern");
    expect(result).not.toContain("src/bar.ts:");
  });
});
