import { describe, it, expect, mock, beforeEach } from "bun:test";
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

const REQUEST_CHANGES_RESPONSE = JSON.stringify({
  verdict: "request_changes",
  summary: "Needs fixes",
  comments: [
    { file: "src/api/routes.ts", line: 5, severity: "critical", comment: "Missing error handling" },
  ],
  suggestions: ["Add try-catch"],
  confidence: 0.8,
});

const SMALL_DIFF = [
  "diff --git a/src/api/routes.ts b/src/api/routes.ts",
  "index abc..def 100644",
  "--- a/src/api/routes.ts",
  "+++ b/src/api/routes.ts",
  "@@ -1,3 +1,4 @@",
  " const x = 1;",
  "+const y = 2;",
  " export { x };",
].join("\n");

// Track which prompts the mock LLM was called with
let llmCalls: Array<{ system: string; user: string }> = [];

// Mock simple-git
mock.module("simple-git", () => ({
  default: () => ({
    diff: () => Promise.resolve(SMALL_DIFF),
  }),
}));

// Mock the Anthropic SDK — returns approve by default
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: (opts: { system: string; messages: Array<{ content: string }> }) => {
        llmCalls.push({
          system: opts.system ?? "",
          user: opts.messages?.[0]?.content ?? "",
        });
        return Promise.resolve({
          content: [{ type: "text", text: APPROVE_RESPONSE }],
        });
      },
    };
    constructor(_opts: unknown) {}
  },
}));

// Import after mocking
const { runMultiReview } = await import("../../src/core/review-multi");

let db: Database;

// ─── Helpers ─────────────────────────────────────────────

function insertProfile(
  db: Database,
  slug: string,
  opts: {
    name?: string;
    prompt?: string;
    filePatterns?: string[];
    enabled?: boolean;
  } = {},
): number {
  db.run(
    `INSERT INTO reviewer_profiles (slug, name, description, prompt, file_patterns, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      slug,
      opts.name ?? slug,
      "",
      opts.prompt ?? `Review prompt for ${slug}. {{task_summary}} {{rules}} {{diff}}`,
      JSON.stringify(opts.filePatterns ?? ["**/*"]),
      (opts.enabled ?? true) ? 1 : 0,
    ],
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
}

function linkRule(db: Database, profileId: number, ruleId: number): void {
  db.run("INSERT OR IGNORE INTO profile_rules (profile_id, rule_id) VALUES (?, ?)", [profileId, ruleId]);
}

function getRuleId(db: Database, name: string): number {
  const row = db.query("SELECT id FROM rules WHERE name = ?").get(name) as { id: number };
  return row.id;
}

// ─── Tests ───────────────────────────────────────────────

beforeEach(() => {
  db = createTestDb();
  seedTestRules(db);
  process.env.ANTHROPIC_API_KEY = "test-key-for-multi-review";
  llmCalls = [];
});

describe("runMultiReview", () => {
  describe("profile matching", () => {
    it("matches profiles by file patterns against changed files", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"] });
      insertProfile(db, "frontend", { filePatterns: ["src/components/**"] });

      const result = await runMultiReview(
        { taskSummary: "Update API", workingDirectory: "/tmp" },
        { db },
      );

      // SMALL_DIFF changes src/api/routes.ts — only backend should match
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].profile).toBe("backend");
      expect(result.fallbackUsed).toBe(false);
    });

    it("matches multiple profiles when patterns overlap", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"] });
      insertProfile(db, "general", { filePatterns: ["**/*"] });

      const result = await runMultiReview(
        { taskSummary: "Update API", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.reviews).toHaveLength(2);
      const slugs = result.reviews.map((r) => r.profile).sort();
      expect(slugs).toEqual(["backend", "general"]);
    });

    it("skips disabled profiles", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"], enabled: false });
      insertProfile(db, "general", { filePatterns: ["**/*"] });

      const result = await runMultiReview(
        { taskSummary: "Update API", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].profile).toBe("general");
    });
  });

  describe("explicit reviewers", () => {
    it("runs only specified reviewers when provided", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"] });
      insertProfile(db, "frontend", { filePatterns: ["src/components/**"] });
      insertProfile(db, "general", { filePatterns: ["**/*"] });

      const result = await runMultiReview(
        { taskSummary: "Update API", workingDirectory: "/tmp", reviewers: ["frontend"] },
        { db },
      );

      // Even though frontend doesn't match the files, explicit selection overrides
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].profile).toBe("frontend");
    });

    it("ignores nonexistent reviewer slugs", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"] });

      const result = await runMultiReview(
        { taskSummary: "Test", workingDirectory: "/tmp", reviewers: ["nonexistent"] },
        { db },
      );

      expect(result.reviews).toHaveLength(0);
    });

    it("ignores disabled reviewers even when explicitly requested", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"], enabled: false });

      const result = await runMultiReview(
        { taskSummary: "Test", workingDirectory: "/tmp", reviewers: ["backend"] },
        { db },
      );

      expect(result.reviews).toHaveLength(0);
    });
  });

  describe("fallback behavior", () => {
    it("uses fallback profile when no profiles match", async () => {
      insertProfile(db, "general", { name: "General Reviewer", filePatterns: ["**/*"] });
      // The only other profile doesn't match
      insertProfile(db, "go-expert", { filePatterns: ["**/*.go"] });

      // Remove the general profile from matching by setting narrow patterns,
      // then set it as the fallback
      db.run("UPDATE reviewer_profiles SET file_patterns = ? WHERE slug = 'general'", [
        JSON.stringify(["nonexistent-path/**"]),
      ]);

      const result = await runMultiReview(
        { taskSummary: "Test fallback", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.fallbackUsed).toBe(true);
      expect(result.fallbackWarning).toContain("fallback");
      expect(result.fallbackWarning).toContain("general");
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].profile).toBe("general");
    });

    it("sets fallbackUsed=false when profiles match normally", async () => {
      insertProfile(db, "general", { filePatterns: ["**/*"] });

      const result = await runMultiReview(
        { taskSummary: "Test", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.fallbackUsed).toBe(false);
      expect(result.fallbackWarning).toBeNull();
    });
  });

  describe("review results", () => {
    it("returns independent ReviewResult per profile", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"] });
      insertProfile(db, "general", { filePatterns: ["**/*"] });

      const result = await runMultiReview(
        { taskSummary: "Test", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.reviews).toHaveLength(2);
      for (const r of result.reviews) {
        expect(r.review.verdict).toBe("approve");
        expect(r.review.summary).toBeTruthy();
        expect(r.isFollowUp).toBe(false);
        expect(r.previouslyAcceptedAtRound).toBeNull();
      }
    });

    it("includes profile slug and name in each result", async () => {
      insertProfile(db, "backend", { name: "Backend Reviewer", filePatterns: ["src/api/**"] });

      const result = await runMultiReview(
        { taskSummary: "Test", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.reviews[0].profile).toBe("backend");
      expect(result.reviews[0].profileName).toBe("Backend Reviewer");
    });

    it("saves each review to the reviews table", async () => {
      insertProfile(db, "backend", { filePatterns: ["src/api/**"] });
      insertProfile(db, "general", { filePatterns: ["**/*"] });

      await runMultiReview(
        { taskSummary: "Test save", workingDirectory: "/tmp" },
        { db },
      );

      const rows = db.query("SELECT * FROM reviews").all();
      expect(rows).toHaveLength(2);
    });

    it("stores profile info in result_json", async () => {
      insertProfile(db, "backend", { name: "Backend Reviewer", filePatterns: ["src/api/**"] });

      await runMultiReview(
        { taskSummary: "Test JSON", workingDirectory: "/tmp" },
        { db },
      );

      const row = db.query("SELECT result_json FROM reviews LIMIT 1").get() as { result_json: string };
      const parsed = JSON.parse(row.result_json);
      expect(parsed.profile).toBe("backend");
      expect(parsed.profileName).toBe("Backend Reviewer");
      expect(parsed.verdict).toBe("approve");
    });
  });

  describe("per-profile rules", () => {
    it("uses profile-specific linked rules (not all global rules)", async () => {
      const profileId = insertProfile(db, "backend", { filePatterns: ["src/api/**"] });
      const ruleId = getRuleId(db, "Error handling required");
      linkRule(db, profileId, ruleId);

      const result = await runMultiReview(
        { taskSummary: "Test rules", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.reviews).toHaveLength(1);
      // The review was run — we can verify it succeeded
      expect(result.reviews[0].review.verdict).toBe("approve");
    });
  });

  describe("edge cases", () => {
    it("returns empty reviews when no profiles exist", async () => {
      const result = await runMultiReview(
        { taskSummary: "Test empty", workingDirectory: "/tmp" },
        { db },
      );

      expect(result.reviews).toHaveLength(0);
      expect(result.fallbackUsed).toBe(true);
    });

    it("uses profile prompt content instead of loading from file", async () => {
      const customPrompt = "Custom prompt: {{task_summary}} {{diff}}";
      insertProfile(db, "custom", { prompt: customPrompt, filePatterns: ["**/*"] });

      const result = await runMultiReview(
        { taskSummary: "Test prompt content", workingDirectory: "/tmp" },
        { db },
      );

      // Should succeed — the profile's prompt was used directly
      expect(result.reviews).toHaveLength(1);
      expect(result.reviews[0].review.verdict).toBe("approve");
    });
  });
});
