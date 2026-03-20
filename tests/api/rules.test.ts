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
    "INSERT INTO rules (slug, name, description, category, severity) VALUES (?, ?, ?, ?, ?)",
    [name.toLowerCase().replace(/\s+/g, "-"), name, "A test rule", "general", "warning"],
  );
}

function insertRuleWithHash(slug: string, name: string, hash: string): number {
  db.run(
    "INSERT INTO rules (slug, name, description, category, severity, source_hash) VALUES (?, ?, ?, ?, ?, ?)",
    [slug, name, "A test rule", "general", "warning", hash],
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
}

function insertUpdate(ruleId: number, hash: string, content: string): number {
  db.run(
    "INSERT INTO rule_updates (rule_id, new_hash, new_content) VALUES (?, ?, ?)",
    [ruleId, hash, content],
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
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

  it("includes update_available count", async () => {
    const ruleId = insertRuleWithHash("test-rule", "Test Rule", "oldhash");
    insertUpdate(ruleId, "newhash", '{"name":"Updated"}');

    const res = await request.get("/api/rules");
    expect(res.body[0].update_available).toBe(1);
  });

  it("update_available is 0 when no pending updates", async () => {
    insertRule("Rule 1");
    const res = await request.get("/api/rules");
    expect(res.body[0].update_available).toBe(0);
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

  it("generates a slug from the name", async () => {
    const res = await request
      .post("/api/rules")
      .send({ name: "My Custom Rule", description: "Desc" });
    expect(res.body.slug).toBe("my-custom-rule");
  });

  it("sets source_hash to null for user-created rules", async () => {
    const res = await request
      .post("/api/rules")
      .send({ name: "User Rule", description: "Desc" });
    expect(res.body.source_hash).toBeNull();
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

  it("cascades to rule_updates", async () => {
    const ruleId = insertRuleWithHash("test", "Test", "hash");
    insertUpdate(ruleId, "newhash", '{"name":"Updated"}');

    await request.delete(`/api/rules/${ruleId}`);

    const updates = db.query("SELECT * FROM rule_updates").all();
    expect(updates.length).toBe(0);
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

describe("GET /api/rules/:id/updates", () => {
  it("returns pending updates for a rule", async () => {
    const ruleId = insertRuleWithHash("test", "Test", "hash");
    insertUpdate(ruleId, "newhash", '{"name":"Updated"}');

    const res = await request.get(`/api/rules/${ruleId}/updates`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].new_hash).toBe("newhash");
  });

  it("excludes dismissed updates", async () => {
    const ruleId = insertRuleWithHash("test", "Test", "hash");
    const updateId = insertUpdate(ruleId, "newhash", '{"name":"Updated"}');
    db.run("UPDATE rule_updates SET dismissed = 1 WHERE id = ?", [updateId]);

    const res = await request.get(`/api/rules/${ruleId}/updates`);
    expect(res.body).toHaveLength(0);
  });

  it("returns empty array when no updates exist", async () => {
    insertRule();
    const res = await request.get("/api/rules/1/updates");
    expect(res.body).toHaveLength(0);
  });
});

describe("POST /api/rules/:id/updates/:updateId/adopt", () => {
  it("applies update content to the rule", async () => {
    const ruleId = insertRuleWithHash("test", "Test", "oldhash");
    const content = JSON.stringify({ name: "Updated Name", description: "Updated Desc", category: "security", severity: "critical" });
    const updateId = insertUpdate(ruleId, "newhash", content);

    const res = await request.post(`/api/rules/${ruleId}/updates/${updateId}/adopt`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
    expect(res.body.description).toBe("Updated Desc");
    expect(res.body.category).toBe("security");
    expect(res.body.severity).toBe("critical");
    expect(res.body.source_hash).toBe("newhash");
  });

  it("dismisses all pending updates for the rule", async () => {
    const ruleId = insertRuleWithHash("test", "Test", "oldhash");
    const content = JSON.stringify({ name: "N", description: "D", category: "general", severity: "warning" });
    insertUpdate(ruleId, "h1", content);
    const updateId = insertUpdate(ruleId, "h2", content);

    await request.post(`/api/rules/${ruleId}/updates/${updateId}/adopt`);

    const pending = db.query("SELECT * FROM rule_updates WHERE rule_id = ? AND dismissed = 0").all(ruleId);
    expect(pending).toHaveLength(0);
  });

  it("returns 404 for nonexistent update", async () => {
    insertRule();
    const res = await request.post("/api/rules/1/updates/999/adopt");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/rules/:id/updates/:updateId/dismiss", () => {
  it("marks the update as dismissed", async () => {
    const ruleId = insertRuleWithHash("test", "Test", "hash");
    const updateId = insertUpdate(ruleId, "newhash", '{"name":"Updated"}');

    const res = await request.post(`/api/rules/${ruleId}/updates/${updateId}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const update = db.query("SELECT dismissed FROM rule_updates WHERE id = ?").get(updateId) as { dismissed: number };
    expect(update.dismissed).toBe(1);
  });
});
