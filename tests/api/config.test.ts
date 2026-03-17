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

describe("GET /api/config", () => {
  it("returns all seeded config values", async () => {
    const res = await request.get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("anthropic");
    expect(res.body.model).toBe("claude-sonnet-4-20250514");
    expect(res.body.baseBranch).toBe("main");
    expect(res.body.maxDiffLines).toBe("5000");
    expect(res.body.chunkSize).toBe("10");
    expect(res.body.httpPort).toBe("3456");
    expect(res.body.maxReviewRounds).toBe("5");
  });
});

describe("PUT /api/config", () => {
  it("updates config values", async () => {
    const res = await request
      .put("/api/config")
      .send({ provider: "openai", model: "gpt-4" });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("openai");
    expect(res.body.model).toBe("gpt-4");
  });

  it("partial update leaves other values unchanged", async () => {
    await request.put("/api/config").send({ model: "gpt-4o" });
    const res = await request.get("/api/config");
    expect(res.body.model).toBe("gpt-4o");
    expect(res.body.provider).toBe("anthropic"); // unchanged
  });

  it("returns updated config after update", async () => {
    const res = await request
      .put("/api/config")
      .send({ baseBranch: "develop" });
    expect(res.body.baseBranch).toBe("develop");
  });

  it("updates maxReviewRounds", async () => {
    const res = await request
      .put("/api/config")
      .send({ maxReviewRounds: "10" });
    expect(res.body.maxReviewRounds).toBe("10");
  });

  it("preserves maxReviewRounds on partial update", async () => {
    await request.put("/api/config").send({ model: "gpt-4o" });
    const res = await request.get("/api/config");
    expect(res.body.maxReviewRounds).toBe("5");
  });
});
