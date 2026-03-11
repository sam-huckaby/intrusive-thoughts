import { describe, it, expect } from "bun:test";
import { join } from "path";
import {
  loadPromptTemplate,
  interpolatePrompt,
  buildPromptVariables,
  buildChunkPromptVariables,
} from "../../../src/core/reviewer/prompt";
import type { PromptVariables } from "../../../src/core/reviewer/prompt";
import type { ReviewContext, DiffChunk } from "../../../src/types";

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
});
