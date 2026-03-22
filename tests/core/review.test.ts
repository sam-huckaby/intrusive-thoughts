import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { createTestDb } from "../db/helpers";
import { seedTestRules } from "../db/helpers";
import type { Database } from "bun:sqlite";

const APPROVE_RESPONSE = JSON.stringify({
  verdict: "approve",
  summary: "Code looks good",
  comments: [],
  suggestions: [],
  confidence: 0.9,
});

const SMALL_DIFF = [
  "diff --git a/src/test.ts b/src/test.ts",
  "index abc..def 100644",
  "--- a/src/test.ts",
  "+++ b/src/test.ts",
  "@@ -1,3 +1,4 @@",
  " const x = 1;",
  "+const y = 2;",
  " export { x };",
].join("\n");

// Mock the Anthropic SDK
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: () =>
        Promise.resolve({
          content: [{ type: "text", text: APPROVE_RESPONSE }],
        }),
    };
    constructor(_opts: unknown) {}
  },
}));

// Import after mocking
const { runReview } = await import("../../src/core/review");

const PROMPT_PATH = join(import.meta.dir, "../fixtures/prompts/test-review.md");

let db: Database;
const originalSpawnSync = Bun.spawnSync;

beforeEach(() => {
  db = createTestDb();
  seedTestRules(db);
  // Set ANTHROPIC_API_KEY for the test
  process.env.ANTHROPIC_API_KEY = "test-key-for-review";
  Bun.spawnSync = ((options: { cmd: string[] }) => {
    const command = options.cmd.join(" ");
    if (command.startsWith("git diff ")) {
      return {
        exitCode: 0,
        stdout: new TextEncoder().encode(SMALL_DIFF),
        stderr: new Uint8Array(),
      } as ReturnType<typeof Bun.spawnSync>;
    }
    if (command === "git rev-parse HEAD") {
      return {
        exitCode: 0,
        stdout: new TextEncoder().encode("test-head\n"),
        stderr: new Uint8Array(),
      } as ReturnType<typeof Bun.spawnSync>;
    }
    throw new Error(`Unexpected git command in test: ${command}`);
  }) as typeof Bun.spawnSync;
});

afterEach(() => {
  Bun.spawnSync = originalSpawnSync;
});

describe("runReview", () => {
  it("returns a ReviewResult with approve verdict", async () => {
    const result = await runReview(
      { taskSummary: "Add feature X", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    expect(result.verdict).toBe("approve");
    expect(result.summary).toBeTruthy();
  });

  it("saves review to history table", async () => {
    await runReview(
      { taskSummary: "Add feature X", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    const rows = db.query("SELECT * FROM reviews").all();
    expect(rows.length).toBe(1);
  });

  it("uses configured provider from database", async () => {
    const result = await runReview(
      { taskSummary: "Test provider config", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    const review = db.query("SELECT provider FROM reviews ORDER BY id DESC LIMIT 1").get() as { provider: string };
    expect(review.provider).toBe("anthropic");
    expect(result.verdict).toBe("approve");
  });

  it("uses configured base branch from database", async () => {
    await runReview(
      { taskSummary: "Test base branch", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    const review = db.query("SELECT base_branch FROM reviews ORDER BY id DESC LIMIT 1").get() as { base_branch: string };
    expect(review.base_branch).toBe("main");
  });

  it("overrides base branch from input", async () => {
    await runReview(
      { taskSummary: "Test override", baseBranch: "develop", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    const review = db.query("SELECT base_branch FROM reviews ORDER BY id DESC LIMIT 1").get() as { base_branch: string };
    expect(review.base_branch).toBe("develop");
  });

  it("stores files reviewed as JSON array", async () => {
    await runReview(
      { taskSummary: "Test files", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    const review = db.query("SELECT files_reviewed FROM reviews ORDER BY id DESC LIMIT 1").get() as { files_reviewed: string };
    const files = JSON.parse(review.files_reviewed);
    expect(Array.isArray(files)).toBe(true);
  });

  it("stores result_json as valid JSON", async () => {
    await runReview(
      { taskSummary: "Test result JSON", workingDirectory: "/tmp" },
      { db, promptPath: PROMPT_PATH },
    );
    const review = db.query("SELECT result_json FROM reviews ORDER BY id DESC LIMIT 1").get() as { result_json: string };
    const parsed = JSON.parse(review.result_json);
    expect(parsed.verdict).toBe("approve");
  });
});
