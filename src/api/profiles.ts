import { Router } from "express";
import { Database } from "bun:sqlite";
import { z } from "zod";

// ─── Validation Schemas ──────────────────────────────────

const CreateProfileSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1),
  description: z.string().default(""),
  prompt: z.string().min(1),
  filePatterns: z.array(z.string()).default(["**/*"]),
  enabled: z.boolean().default(true),
});

const UpdateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  prompt: z.string().min(1).optional(),
  filePatterns: z.array(z.string()).optional(),
});

const SetRulesSchema = z.object({
  ruleIds: z.array(z.number()),
});

const AddRuleSchema = z.object({
  ruleId: z.number(),
});

// ─── Router ──────────────────────────────────────────────

export function createProfilesRouter(db: Database): Router {
  const router = Router();

  router.get("/", (_req, res) => handleListProfiles(db, res));
  router.get("/:id", (req, res) => handleGetProfile(db, req.params.id, res));
  router.post("/", (req, res) => handleCreateProfile(db, req.body, res));
  router.put("/:id", (req, res) => handleUpdateProfile(db, req.params.id, req.body, res));
  router.delete("/:id", (req, res) => handleDeleteProfile(db, req.params.id, res));
  router.patch("/:id/toggle", (req, res) => handleToggleProfile(db, req.params.id, res));

  // Rule linking
  router.put("/:id/rules", (req, res) => handleSetRules(db, req.params.id, req.body, res));
  router.post("/:id/rules", (req, res) => handleAddRule(db, req.params.id, req.body, res));
  router.delete("/:id/rules/:ruleId", (req, res) =>
    handleRemoveRule(db, req.params.id, req.params.ruleId, res),
  );

  // Update notifications
  router.get("/:id/updates", (req, res) => handleGetUpdates(db, req.params.id, res));
  router.post("/:id/updates/:updateId/adopt", (req, res) =>
    handleAdoptUpdate(db, req.params.id, req.params.updateId, res),
  );
  router.post("/:id/updates/:updateId/dismiss", (req, res) =>
    handleDismissUpdate(db, req.params.updateId, res),
  );

  return router;
}

// ─── Handlers ────────────────────────────────────────────

type Res = {
  json: (body: unknown) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

function handleListProfiles(db: Database, res: Res): void {
  const profiles = db
    .query(
      `SELECT rp.*,
        (SELECT COUNT(*) FROM profile_rules pr WHERE pr.profile_id = rp.id) as rule_count,
        (SELECT COUNT(*) FROM profile_updates pu WHERE pu.profile_id = rp.id AND pu.dismissed = 0) as update_available
       FROM reviewer_profiles rp
       ORDER BY rp.slug`,
    )
    .all();
  res.json(profiles);
}

function handleGetProfile(db: Database, id: string, res: Res): void {
  const profile = db
    .query("SELECT * FROM reviewer_profiles WHERE id = ?")
    .get(id);

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const rules = db
    .query(
      `SELECT r.* FROM rules r
       JOIN profile_rules pr ON pr.rule_id = r.id
       WHERE pr.profile_id = ?
       ORDER BY r.name`,
    )
    .all(id);

  const updates = db
    .query(
      "SELECT * FROM profile_updates WHERE profile_id = ? AND dismissed = 0 ORDER BY detected_at DESC",
    )
    .all(id);

  res.json({ ...profile, rules, updates });
}

function handleCreateProfile(db: Database, body: unknown, res: Res): void {
  const parsed = CreateProfileSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { slug, name, description, prompt, filePatterns, enabled } = parsed.data;

  // Check for duplicate slug
  const existing = db.query("SELECT id FROM reviewer_profiles WHERE slug = ?").get(slug);
  if (existing) {
    res.status(409).json({ error: `Profile with slug '${slug}' already exists` });
    return;
  }

  db.run(
    `INSERT INTO reviewer_profiles (slug, name, description, prompt, file_patterns, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [slug, name, description, prompt, JSON.stringify(filePatterns), enabled ? 1 : 0],
  );

  const row = db
    .query("SELECT * FROM reviewer_profiles WHERE slug = ?")
    .get(slug);
  res.json(row);
}

function handleUpdateProfile(db: Database, id: string, body: unknown, res: Res): void {
  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const clauses: string[] = [];
  const values: (string | number)[] = [];

  if (parsed.data.name !== undefined) {
    clauses.push("name = ?");
    values.push(parsed.data.name);
  }
  if (parsed.data.description !== undefined) {
    clauses.push("description = ?");
    values.push(parsed.data.description);
  }
  if (parsed.data.prompt !== undefined) {
    clauses.push("prompt = ?");
    values.push(parsed.data.prompt);
  }
  if (parsed.data.filePatterns !== undefined) {
    clauses.push("file_patterns = ?");
    values.push(JSON.stringify(parsed.data.filePatterns));
  }

  if (clauses.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  db.run(
    `UPDATE reviewer_profiles SET ${clauses.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...values, id],
  );

  const row = db.query("SELECT * FROM reviewer_profiles WHERE id = ?").get(id);
  row ? res.json(row) : res.status(404).json({ error: "Profile not found" });
}

function handleDeleteProfile(db: Database, id: string, res: Res): void {
  // Manually cascade since SQLite foreign_keys pragma may not be enabled
  db.run("DELETE FROM profile_rules WHERE profile_id = ?", [id]);
  db.run("DELETE FROM profile_updates WHERE profile_id = ?", [id]);
  db.run("DELETE FROM reviewer_profiles WHERE id = ?", [id]);
  res.json({ ok: true });
}

function handleToggleProfile(db: Database, id: string, res: Res): void {
  db.run(
    "UPDATE reviewer_profiles SET enabled = 1 - enabled, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  const row = db.query("SELECT * FROM reviewer_profiles WHERE id = ?").get(id);
  row ? res.json(row) : res.status(404).json({ error: "Profile not found" });
}

// ─── Rule linking ────────────────────────────────────────

function handleSetRules(db: Database, profileId: string, body: unknown, res: Res): void {
  const parsed = SetRulesSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const profile = db.query("SELECT id FROM reviewer_profiles WHERE id = ?").get(profileId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // Replace all links
  db.run("DELETE FROM profile_rules WHERE profile_id = ?", [profileId]);
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO profile_rules (profile_id, rule_id) VALUES (?, ?)",
  );
  for (const ruleId of parsed.data.ruleIds) {
    stmt.run(profileId, ruleId);
  }

  const rules = db
    .query(
      `SELECT r.* FROM rules r
       JOIN profile_rules pr ON pr.rule_id = r.id
       WHERE pr.profile_id = ?
       ORDER BY r.name`,
    )
    .all(profileId);

  res.json(rules);
}

function handleAddRule(db: Database, profileId: string, body: unknown, res: Res): void {
  const parsed = AddRuleSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const profile = db.query("SELECT id FROM reviewer_profiles WHERE id = ?").get(profileId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  db.run(
    "INSERT OR IGNORE INTO profile_rules (profile_id, rule_id) VALUES (?, ?)",
    [profileId, parsed.data.ruleId],
  );

  res.json({ ok: true });
}

function handleRemoveRule(db: Database, profileId: string, ruleId: string, res: Res): void {
  db.run("DELETE FROM profile_rules WHERE profile_id = ? AND rule_id = ?", [profileId, ruleId]);
  res.json({ ok: true });
}

// ─── Update notifications ────────────────────────────────

function handleGetUpdates(db: Database, profileId: string, res: Res): void {
  const updates = db
    .query(
      "SELECT * FROM profile_updates WHERE profile_id = ? AND dismissed = 0 ORDER BY detected_at DESC",
    )
    .all(profileId);
  res.json(updates);
}

function handleAdoptUpdate(db: Database, profileId: string, updateId: string, res: Res): void {
  const update = db
    .query("SELECT * FROM profile_updates WHERE id = ? AND profile_id = ?")
    .get(updateId, profileId) as {
    id: number;
    new_hash: string;
    new_content: string;
  } | null;

  if (!update) {
    res.status(404).json({ error: "Update not found" });
    return;
  }

  // Update the profile with new content and hash
  db.run(
    `UPDATE reviewer_profiles SET prompt = ?, source_hash = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [update.new_content, update.new_hash, profileId],
  );

  // Mark this and any older updates for this profile as dismissed
  db.run("UPDATE profile_updates SET dismissed = 1 WHERE profile_id = ?", [profileId]);

  const profile = db.query("SELECT * FROM reviewer_profiles WHERE id = ?").get(profileId);
  res.json(profile);
}

function handleDismissUpdate(db: Database, updateId: string, res: Res): void {
  db.run("UPDATE profile_updates SET dismissed = 1 WHERE id = ?", [updateId]);
  res.json({ ok: true });
}
