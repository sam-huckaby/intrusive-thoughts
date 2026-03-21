import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import supertest from "supertest";
import { createApp } from "../../src/server/http";
import { createTestDb } from "../db/helpers";
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Database } from "bun:sqlite";

let db: Database;
let request: ReturnType<typeof supertest>;
let tempPromptPath: string;
let tempConfigDir: string;

beforeEach(() => {
  db = createTestDb();
  tempPromptPath = join(tmpdir(), `test-prompt-${Date.now()}.md`);
  tempConfigDir = mkdtempSync(join(tmpdir(), "it-config-"));
  writeFileSync(tempPromptPath, "Original prompt content with {{task_summary}}");
  const app = createApp({ db, promptPath: tempPromptPath, userConfigDir: tempConfigDir });
  request = supertest(app);
});

afterEach(() => {
  try {
    unlinkSync(tempPromptPath);
  } catch {
    // ignore
  }
  try {
    rmSync(tempConfigDir, { recursive: true });
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
  it("writes new content to the user config directory", async () => {
    const res = await request
      .put("/api/prompt")
      .send({ content: "Updated prompt template" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const writtenPath = join(tempConfigDir, "code-review.md");
    const fileContent = readFileSync(writtenPath, "utf-8");
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

  it("returns 400 when no user config dir is available", async () => {
    const appNoConfig = createApp({ db, promptPath: tempPromptPath, userConfigDir: null });
    const reqNoConfig = supertest(appNoConfig);
    const res = await reqNoConfig
      .put("/api/prompt")
      .send({ content: "Should fail" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No writable config directory");
  });
});
