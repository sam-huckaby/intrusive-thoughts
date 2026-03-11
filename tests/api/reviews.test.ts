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

function insertReview(taskSummary: string = "Test task"): void {
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

describe("GET /api/reviews", () => {
  it("returns empty array when no reviews exist", async () => {
    const res = await request.get("/api/reviews");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all reviews", async () => {
    insertReview("Task 1");
    insertReview("Task 2");
    const res = await request.get("/api/reviews");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("returns reviews in descending order", async () => {
    insertReview("First");
    insertReview("Second");
    const res = await request.get("/api/reviews");
    expect(res.body[0].task_summary).toBe("Second");
  });
});

describe("GET /api/reviews/:id", () => {
  it("returns a full review including result_json", async () => {
    insertReview();
    const res = await request.get("/api/reviews/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.result_json).toBeTruthy();
    expect(res.body.task_summary).toBe("Test task");
  });

  it("returns 404 for nonexistent review", async () => {
    const res = await request.get("/api/reviews/999");
    expect(res.status).toBe(404);
  });
});
