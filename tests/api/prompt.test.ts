import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import supertest from "supertest";
import { createApp } from "../../src/server/http";
import { createTestDb } from "../db/helpers";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Database } from "bun:sqlite";

let db: Database;
let request: ReturnType<typeof supertest>;
let tempPromptPath: string;

beforeEach(() => {
  db = createTestDb();
  tempPromptPath = join(tmpdir(), `test-prompt-${Date.now()}.md`);
  writeFileSync(tempPromptPath, "Original prompt content with {{task_summary}}");
  const app = createApp({ db, promptPath: tempPromptPath });
  request = supertest(app);
});

afterEach(() => {
  try {
    unlinkSync(tempPromptPath);
  } catch {
    // ignore
  }
});

describe("GET /api/prompt", () => {
  it("returns the current prompt template content", async () => {
    const res = await request.get("/api/prompt");
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Original prompt content with {{task_summary}}");
  });
});

describe("PUT /api/prompt", () => {
  it("writes new content to the prompt file", async () => {
    const res = await request
      .put("/api/prompt")
      .send({ content: "Updated prompt template" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const fileContent = readFileSync(tempPromptPath, "utf-8");
    expect(fileContent).toBe("Updated prompt template");
  });

  it("returns 400 when content is missing", async () => {
    const res = await request
      .put("/api/prompt")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when content is empty string", async () => {
    const res = await request
      .put("/api/prompt")
      .send({ content: "" });
    expect(res.status).toBe(400);
  });
});
