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

function insertRule(name: string = "Test Rule"): void {
  db.run(
    "INSERT INTO rules (name, description, category, severity) VALUES (?, ?, ?, ?)",
    [name, "A test rule", "general", "warning"],
  );
}

describe("GET /api/rules", () => {
  it("returns empty array when no rules exist", async () => {
    const res = await request.get("/api/rules");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all rules", async () => {
    insertRule("Rule 1");
    insertRule("Rule 2");
    const res = await request.get("/api/rules");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});

describe("POST /api/rules", () => {
  it("creates a rule and returns it with generated id", async () => {
    const res = await request
      .post("/api/rules")
      .send({ name: "New Rule", description: "A new rule" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("New Rule");
    expect(res.body.description).toBe("A new rule");
  });

  it("defaults category to general", async () => {
    const res = await request
      .post("/api/rules")
      .send({ name: "Test", description: "Desc" });
    expect(res.body.category).toBe("general");
  });

  it("defaults severity to warning", async () => {
    const res = await request
      .post("/api/rules")
      .send({ name: "Test", description: "Desc" });
    expect(res.body.severity).toBe("warning");
  });

  it("returns 400 when name is missing", async () => {
    const res = await request
      .post("/api/rules")
      .send({ description: "No name" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is missing", async () => {
    const res = await request
      .post("/api/rules")
      .send({ name: "No desc" });
    expect(res.status).toBe(400);
  });

  it("accepts custom category and severity", async () => {
    const res = await request
      .post("/api/rules")
      .send({
        name: "Security Rule",
        description: "Check for SQL injection",
        category: "security",
        severity: "critical",
      });
    expect(res.body.category).toBe("security");
    expect(res.body.severity).toBe("critical");
  });
});

describe("PUT /api/rules/:id", () => {
  it("updates specified fields", async () => {
    insertRule();
    const res = await request
      .put("/api/rules/1")
      .send({ name: "Updated Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("returns 404 for nonexistent rule", async () => {
    const res = await request
      .put("/api/rules/999")
      .send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when no fields provided", async () => {
    insertRule();
    const res = await request
      .put("/api/rules/1")
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/rules/:id", () => {
  it("deletes a rule and returns ok", async () => {
    insertRule();
    const res = await request.delete("/api/rules/1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const rows = db.query("SELECT * FROM rules").all();
    expect(rows.length).toBe(0);
  });
});

describe("PATCH /api/rules/:id/toggle", () => {
  it("toggles enabled from 1 to 0", async () => {
    insertRule();
    const res = await request.patch("/api/rules/1/toggle");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(0);
  });

  it("toggles enabled from 0 back to 1", async () => {
    insertRule();
    await request.patch("/api/rules/1/toggle");
    const res = await request.patch("/api/rules/1/toggle");
    expect(res.body.enabled).toBe(1);
  });

  it("returns 404 for nonexistent rule", async () => {
    const res = await request.patch("/api/rules/999/toggle");
    expect(res.status).toBe(404);
  });
});
