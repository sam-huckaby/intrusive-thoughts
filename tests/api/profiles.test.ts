import { describe, it, expect, beforeEach } from "bun:test";
import supertest from "supertest";
import { createApp } from "../../src/server/http";
import { createTestDb } from "../db/helpers";
import { seedTestRules } from "../db/helpers";
import type { Database } from "bun:sqlite";
import { join } from "path";

const PROMPT_PATH = join(import.meta.dir, "../fixtures/prompts/test-review.md");
let db: Database;
let request: ReturnType<typeof supertest>;

beforeEach(() => {
  db = createTestDb();
  seedTestRules(db);
  const app = createApp({ db, promptPath: PROMPT_PATH });
  request = supertest(app);
});

// ─── Helpers ─────────────────────────────────────────────

function insertProfile(
  slug: string,
  opts: { name?: string; prompt?: string; filePatterns?: string[]; enabled?: boolean } = {},
): number {
  db.run(
    `INSERT INTO reviewer_profiles (slug, name, description, prompt, file_patterns, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      slug,
      opts.name ?? slug,
      "",
      opts.prompt ?? `Prompt for ${slug}`,
      JSON.stringify(opts.filePatterns ?? ["**/*"]),
      (opts.enabled ?? true) ? 1 : 0,
    ],
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
}

function getRuleId(name: string): number {
  const row = db.query("SELECT id FROM rules WHERE name = ?").get(name) as { id: number };
  return row.id;
}

function linkRule(profileId: number, ruleId: number): void {
  db.run("INSERT OR IGNORE INTO profile_rules (profile_id, rule_id) VALUES (?, ?)", [profileId, ruleId]);
}

function insertUpdate(profileId: number, hash: string, content: string): number {
  db.run(
    "INSERT INTO profile_updates (profile_id, new_hash, new_content) VALUES (?, ?, ?)",
    [profileId, hash, content],
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
}

// ─── Tests ───────────────────────────────────────────────

describe("GET /api/profiles", () => {
  it("returns empty array when no profiles exist", async () => {
    const res = await request.get("/api/profiles");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all profiles with rule_count and update_available", async () => {
    const id = insertProfile("backend");
    const ruleId = getRuleId("Error handling required");
    linkRule(id, ruleId);
    insertProfile("frontend");

    const res = await request.get("/api/profiles");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const backend = res.body.find((p: { slug: string }) => p.slug === "backend");
    expect(backend.rule_count).toBe(1);
    expect(backend.update_available).toBe(0);
  });

  it("returns profiles sorted by slug", async () => {
    insertProfile("zebra");
    insertProfile("alpha");
    const res = await request.get("/api/profiles");
    expect(res.body[0].slug).toBe("alpha");
    expect(res.body[1].slug).toBe("zebra");
  });
});

describe("GET /api/profiles/:id", () => {
  it("returns profile with linked rules and updates", async () => {
    const id = insertProfile("backend", { name: "Backend Reviewer" });
    const ruleId = getRuleId("Error handling required");
    linkRule(id, ruleId);

    const res = await request.get(`/api/profiles/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("backend");
    expect(res.body.name).toBe("Backend Reviewer");
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.rules[0].name).toBe("Error handling required");
    expect(res.body.updates).toEqual([]);
  });

  it("returns 404 for nonexistent profile", async () => {
    const res = await request.get("/api/profiles/999");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/profiles", () => {
  it("creates a profile and returns it", async () => {
    const res = await request.post("/api/profiles").send({
      slug: "new-profile",
      name: "New Profile",
      prompt: "Review this code.",
      filePatterns: ["src/**"],
    });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("new-profile");
    expect(res.body.name).toBe("New Profile");
    expect(res.body.prompt).toBe("Review this code.");
  });

  it("returns 400 for missing required fields", async () => {
    const res = await request.post("/api/profiles").send({ slug: "test" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid slug format", async () => {
    const res = await request.post("/api/profiles").send({
      slug: "Invalid Slug!",
      name: "Test",
      prompt: "Prompt",
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate slug", async () => {
    insertProfile("existing");
    const res = await request.post("/api/profiles").send({
      slug: "existing",
      name: "Duplicate",
      prompt: "Prompt",
    });
    expect(res.status).toBe(409);
  });

  it("defaults filePatterns to catch-all", async () => {
    const res = await request.post("/api/profiles").send({
      slug: "default-patterns",
      name: "Test",
      prompt: "Prompt",
    });
    expect(res.body.file_patterns).toBe(JSON.stringify(["**/*"]));
  });
});

describe("PUT /api/profiles/:id", () => {
  it("updates specified fields", async () => {
    const id = insertProfile("backend");
    const res = await request.put(`/api/profiles/${id}`).send({ name: "Updated Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
  });

  it("updates file patterns as JSON", async () => {
    const id = insertProfile("backend");
    const res = await request
      .put(`/api/profiles/${id}`)
      .send({ filePatterns: ["src/api/**", "src/server/**"] });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.file_patterns)).toEqual(["src/api/**", "src/server/**"]);
  });

  it("returns 404 for nonexistent profile", async () => {
    const res = await request.put("/api/profiles/999").send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when no fields provided", async () => {
    const id = insertProfile("backend");
    const res = await request.put(`/api/profiles/${id}`).send({});
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/profiles/:id", () => {
  it("deletes a profile", async () => {
    const id = insertProfile("backend");
    const res = await request.delete(`/api/profiles/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const rows = db.query("SELECT * FROM reviewer_profiles").all();
    expect(rows).toHaveLength(0);
  });

  it("cascades to profile_rules", async () => {
    const id = insertProfile("backend");
    const ruleId = getRuleId("Error handling required");
    linkRule(id, ruleId);

    await request.delete(`/api/profiles/${id}`);

    const links = db.query("SELECT * FROM profile_rules").all();
    expect(links).toHaveLength(0);
  });
});

describe("PATCH /api/profiles/:id/toggle", () => {
  it("toggles enabled from 1 to 0", async () => {
    const id = insertProfile("backend");
    const res = await request.patch(`/api/profiles/${id}/toggle`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(0);
  });

  it("toggles enabled from 0 back to 1", async () => {
    const id = insertProfile("backend", { enabled: false });
    const res = await request.patch(`/api/profiles/${id}/toggle`);
    expect(res.body.enabled).toBe(1);
  });

  it("returns 404 for nonexistent profile", async () => {
    const res = await request.patch("/api/profiles/999/toggle");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/profiles/:id/rules (set rules)", () => {
  it("replaces all linked rules", async () => {
    const id = insertProfile("backend");
    const r1 = getRuleId("Error handling required");
    const r2 = getRuleId("No code duplication");
    linkRule(id, r1);

    const res = await request
      .put(`/api/profiles/${id}/rules`)
      .send({ ruleIds: [r2] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("No code duplication");
  });

  it("returns 404 for nonexistent profile", async () => {
    const res = await request
      .put("/api/profiles/999/rules")
      .send({ ruleIds: [1] });
    expect(res.status).toBe(404);
  });

  it("clears all rules when empty array", async () => {
    const id = insertProfile("backend");
    const r1 = getRuleId("Error handling required");
    linkRule(id, r1);

    const res = await request
      .put(`/api/profiles/${id}/rules`)
      .send({ ruleIds: [] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("POST /api/profiles/:id/rules (add rule)", () => {
  it("adds a rule link", async () => {
    const id = insertProfile("backend");
    const ruleId = getRuleId("Error handling required");

    const res = await request
      .post(`/api/profiles/${id}/rules`)
      .send({ ruleId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const links = db.query("SELECT * FROM profile_rules WHERE profile_id = ?").all(id);
    expect(links).toHaveLength(1);
  });

  it("is idempotent (adding same rule twice)", async () => {
    const id = insertProfile("backend");
    const ruleId = getRuleId("Error handling required");

    await request.post(`/api/profiles/${id}/rules`).send({ ruleId });
    await request.post(`/api/profiles/${id}/rules`).send({ ruleId });

    const links = db.query("SELECT * FROM profile_rules WHERE profile_id = ?").all(id);
    expect(links).toHaveLength(1);
  });

  it("returns 404 for nonexistent profile", async () => {
    const res = await request
      .post("/api/profiles/999/rules")
      .send({ ruleId: 1 });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/profiles/:id/rules/:ruleId", () => {
  it("removes a rule link", async () => {
    const id = insertProfile("backend");
    const ruleId = getRuleId("Error handling required");
    linkRule(id, ruleId);

    const res = await request.delete(`/api/profiles/${id}/rules/${ruleId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const links = db.query("SELECT * FROM profile_rules WHERE profile_id = ?").all(id);
    expect(links).toHaveLength(0);
  });
});

describe("GET /api/profiles/:id/updates", () => {
  it("returns pending updates", async () => {
    const id = insertProfile("backend");
    insertUpdate(id, "newhash", "new content");

    const res = await request.get(`/api/profiles/${id}/updates`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].new_hash).toBe("newhash");
  });

  it("excludes dismissed updates", async () => {
    const id = insertProfile("backend");
    const updateId = insertUpdate(id, "newhash", "new content");
    db.run("UPDATE profile_updates SET dismissed = 1 WHERE id = ?", [updateId]);

    const res = await request.get(`/api/profiles/${id}/updates`);
    expect(res.body).toHaveLength(0);
  });
});

describe("POST /api/profiles/:id/updates/:updateId/adopt", () => {
  it("adopts the update — replaces profile content and hash", async () => {
    const id = insertProfile("backend", { prompt: "Old prompt" });
    const updateId = insertUpdate(id, "newhash123", "New prompt content");

    const res = await request.post(`/api/profiles/${id}/updates/${updateId}/adopt`);
    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe("New prompt content");
    expect(res.body.source_hash).toBe("newhash123");
  });

  it("dismisses all updates for the profile after adoption", async () => {
    const id = insertProfile("backend");
    insertUpdate(id, "h1", "c1");
    insertUpdate(id, "h2", "c2");

    const updateId = db.query(
      "SELECT id FROM profile_updates WHERE profile_id = ? ORDER BY id DESC LIMIT 1",
    ).get(id) as { id: number };

    await request.post(`/api/profiles/${id}/updates/${updateId.id}/adopt`);

    const pending = db
      .query("SELECT * FROM profile_updates WHERE profile_id = ? AND dismissed = 0")
      .all(id);
    expect(pending).toHaveLength(0);
  });

  it("returns 404 for nonexistent update", async () => {
    const id = insertProfile("backend");
    const res = await request.post(`/api/profiles/${id}/updates/999/adopt`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/profiles/:id/updates/:updateId/dismiss", () => {
  it("marks the update as dismissed", async () => {
    const id = insertProfile("backend");
    const updateId = insertUpdate(id, "hash", "content");

    const res = await request.post(`/api/profiles/${id}/updates/${updateId}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const update = db.query("SELECT dismissed FROM profile_updates WHERE id = ?").get(updateId) as {
      dismissed: number;
    };
    expect(update.dismissed).toBe(1);
  });
});
