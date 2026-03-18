import { describe, it, expect, beforeEach } from "bun:test";
import supertest from "supertest";
import { createApp } from "../../src/server/http";
import { createTestDb } from "../db/helpers";
import type { Database } from "bun:sqlite";
import { join } from "path";

const PROMPT_PATH = join(import.meta.dir, "../fixtures/prompts/test-review.md");
let db: Database;
let request: ReturnType<typeof supertest>;

beforeEach(() => {
  db = createTestDb();
  const app = createApp({ db, promptPath: PROMPT_PATH });
  request = supertest(app);
});

/** Insert a review in the old format (no profile info). */
function insertOldFormatReview(taskSummary: string = "Test task"): void {
  db.run(
    `INSERT INTO reviews (task_summary, base_branch, verdict, result_json, files_reviewed, provider, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      taskSummary,
      "main",
      "approve",
      JSON.stringify({ verdict: "approve", summary: "OK", comments: [], suggestions: [], confidence: 0.9 }),
      JSON.stringify(["src/test.ts"]),
      "anthropic",
      "claude-sonnet-4-20250514",
    ],
  );
}

/** Insert a review in the new format (with profile/profileName). */
function insertProfileReview(
  taskSummary: string = "Test task",
  profileSlug: string = "general",
  profileName: string = "General",
): void {
  db.run(
    `INSERT INTO reviews (task_summary, base_branch, verdict, result_json, files_reviewed, provider, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      taskSummary,
      "main",
      "approve",
      JSON.stringify({
        profile: profileSlug,
        profileName,
        verdict: "approve",
        summary: "Looks good",
        comments: [],
        suggestions: [],
        confidence: 0.85,
      }),
      JSON.stringify(["src/test.ts"]),
      "anthropic",
      "claude-sonnet-4-20250514",
    ],
  );
}

describe("GET /api/reviews", () => {
  it("returns empty array when no reviews exist", async () => {
    const res = await request.get("/api/reviews");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all reviews", async () => {
    insertOldFormatReview("Task 1");
    insertOldFormatReview("Task 2");
    const res = await request.get("/api/reviews");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("returns reviews in descending order", async () => {
    insertOldFormatReview("First");
    insertOldFormatReview("Second");
    const res = await request.get("/api/reviews");
    expect(res.body[0].task_summary).toBe("Second");
  });

  it("returns mixed old and new format reviews", async () => {
    insertOldFormatReview("Old review");
    insertProfileReview("New review", "security", "Security");
    const res = await request.get("/api/reviews");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});

describe("GET /api/reviews/:id", () => {
  it("returns an old-format review with result_json", async () => {
    insertOldFormatReview();
    const res = await request.get("/api/reviews/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.result_json).toBeTruthy();
    expect(res.body.task_summary).toBe("Test task");
    const parsed = JSON.parse(res.body.result_json);
    expect(parsed.profile).toBeUndefined();
    expect(parsed.verdict).toBe("approve");
  });

  it("returns a new-format review with profile info in result_json", async () => {
    insertProfileReview("Profile review", "security", "Security Reviewer");
    const res = await request.get("/api/reviews/1");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result_json);
    expect(parsed.profile).toBe("security");
    expect(parsed.profileName).toBe("Security Reviewer");
    expect(parsed.verdict).toBe("approve");
    expect(parsed.summary).toBe("Looks good");
  });

  it("returns 404 for nonexistent review", async () => {
    const res = await request.get("/api/reviews/999");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/reviews/run", () => {
  it("rejects request without taskSummary", async () => {
    const res = await request.post("/api/reviews/run").send({});
    expect(res.status).toBe(400);
  });

  it("rejects request with empty taskSummary", async () => {
    const res = await request.post("/api/reviews/run").send({ taskSummary: "" });
    expect(res.status).toBe(400);
  });

  it("accepts request with reviewers field in schema", async () => {
    // This tests that the schema validates reviewers as optional string array.
    // The actual review won't run (no git repo), so we expect a 500 from the
    // downstream git call, not a 400 validation error.
    const res = await request.post("/api/reviews/run").send({
      taskSummary: "Test with reviewers",
      reviewers: ["general", "security"],
    });
    // Should NOT be a 400 (validation error) — the reviewers field is accepted
    expect(res.status).not.toBe(400);
  });
});
