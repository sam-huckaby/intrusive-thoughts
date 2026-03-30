import { describe, it, expect, beforeEach, mock } from "bun:test";
import supertest from "supertest";
import { createTestDb } from "../db/helpers";
import type { Database } from "bun:sqlite";
import { join } from "path";

const PROMPT_PATH = join(import.meta.dir, "../fixtures/prompts/test-review.md");

let responseQueue: string[] = [];

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: () => Promise.resolve({
        content: [{ type: "text", text: responseQueue.shift() ?? "{}" }],
      }),
    };
    constructor(_opts: unknown) {}
  },
}));

const { createApp } = await import("../../src/server/http");

let db: Database;
let request: ReturnType<typeof supertest>;

beforeEach(() => {
  db = createTestDb();
  const app = createApp({ db, promptPath: PROMPT_PATH });
  request = supertest(app);
  process.env.ANTHROPIC_API_KEY = "eval-test-key";
  responseQueue = [];
});

describe("/api/evals fixtures", () => {
  it("creates and retrieves an eval fixture with structured findings", async () => {
    const createRes = await request.post("/api/evals/fixtures").send({
      name: "Unsafe fetch",
      fileName: "src/api.ts",
      language: "ts",
      code: "const data = await fetch(url);",
      notes: "Check async safety",
      findings: [
        {
          title: "Missing error handling",
          description: "The fetch call lacks error handling.",
          severity: "critical",
          lineHint: "1",
          required: true,
          tags: ["async", "error-handling"],
        },
      ],
    });
    expect(createRes.status).toBe(200);
    expect(createRes.body.name).toBe("Unsafe fetch");
    expect(createRes.body.findings).toHaveLength(1);
    expect(createRes.body.findings[0].severity).toBe("critical");

    const getRes = await request.get(`/api/evals/fixtures/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.fileName).toBe("src/api.ts");
    expect(getRes.body.findings[0].tags).toEqual(["async", "error-handling"]);
  });

  it("rejects invalid fixture severity", async () => {
    const res = await request.post("/api/evals/fixtures").send({
      name: "Bad fixture",
      fileName: "src/a.ts",
      language: "ts",
      code: "const x = 1;",
      notes: "",
      findings: [
        {
          title: "Bad",
          description: "Bad",
          severity: "nitpick",
          lineHint: "",
          required: true,
          tags: [],
        },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe("/api/evals/run", () => {
  it("runs an eval, preserves reviewer reports, and stores merged judge output", async () => {
    insertProfile(db, "general", "General Reviewer");
    insertProfile(db, "security", "Security Reviewer");

    const fixtureRes = await request.post("/api/evals/fixtures").send({
      name: "Token leak",
      fileName: "src/auth.ts",
      language: "ts",
      code: "console.log(token);\nreturn token;",
      notes: "",
      findings: [
        {
          title: "Sensitive token exposure",
          description: "The token is logged or exposed unsafely.",
          severity: "critical",
          lineHint: "1",
          required: true,
          tags: ["security"],
        },
      ],
    });
    const fixtureId = fixtureRes.body.id;

    responseQueue = [
      JSON.stringify({
        verdict: "request_changes",
        summary: "Token handling is unsafe.",
        comments: [
          {
            file: "src/auth.ts",
            line: 1,
            severity: "critical",
            comment: "Logging the token exposes sensitive credentials.",
          },
        ],
        suggestions: ["Remove token logging."],
        confidence: 0.9,
      }),
      JSON.stringify({
        verdict: "request_changes",
        summary: "Auth changes leak the token.",
        comments: [
          {
            file: "src/auth.ts",
            line: 1,
            severity: "critical",
            comment: "The token is written to logs, which leaks a secret.",
          },
        ],
        suggestions: ["Do not print secrets."],
        confidence: 0.8,
      }),
      JSON.stringify({
        score: 1,
        summary: "The merged report found the required security issue.",
        findings: [
          {
            findingId: 1,
            status: "matched",
            rationale: "The combined report correctly identifies token exposure.",
            matchedCommentIndexes: [0],
          },
        ],
        extras: [],
      }),
    ];

    const runRes = await request.post("/api/evals/run").send({
      fixtureIds: [fixtureId],
      reviewers: ["general", "security"],
    });

    expect(runRes.status).toBe(200);
    expect(runRes.body.reviewerReports).toHaveLength(2);
    expect(runRes.body.mergedReport.comments).toHaveLength(1);
    expect(runRes.body.mergedReport.comments[0].sources).toHaveLength(2);
    expect(runRes.body.judgeResult.score).toBe(1);

    const listRes = await request.get("/api/evals/runs");
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const detailRes = await request.get(`/api/evals/runs/${runRes.body.id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.reviewerSlugs).toEqual(["general", "security"]);
  });
});

function insertProfile(db: Database, slug: string, name: string): void {
  db.run(
    `INSERT INTO reviewer_profiles (slug, name, description, prompt, file_patterns, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      slug,
      name,
      "",
      "You are a reviewer. {{task_summary}} {{rules}} {{diff}}",
      JSON.stringify(["**/*"]),
      1,
    ],
  );
}
