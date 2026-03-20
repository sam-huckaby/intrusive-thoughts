import { Router } from "express";
import { Database } from "bun:sqlite";
import { z } from "zod";

const CreateRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z
    .enum(["style", "security", "performance", "architecture", "maintainability", "general"])
    .default("general"),
  severity: z.enum(["critical", "warning", "suggestion"]).default("warning"),
});

const UpdateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  category: z
    .enum(["style", "security", "performance", "architecture", "maintainability", "general"])
    .optional(),
  severity: z.enum(["critical", "warning", "suggestion"]).optional(),
});

type Res = { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void };

export function createRulesRouter(db: Database): Router {
  const router = Router();
  router.get("/", (_req, res) => handleListRules(db, res));
  router.post("/", (req, res) => handleCreateRule(db, req.body, res));
  router.put("/:id", (req, res) => handleUpdateRule(db, req.params.id, req.body, res));
  router.delete("/:id", (req, res) => handleDeleteRule(db, req.params.id, res));
  router.patch("/:id/toggle", (req, res) => handleToggleRule(db, req.params.id, res));
  router.get("/:id/updates", (req, res) => handleGetUpdates(db, req.params.id, res));
  router.post("/:id/updates/:updateId/adopt", (req, res) => handleAdoptUpdate(db, req.params.id, req.params.updateId, res));
  router.post("/:id/updates/:updateId/dismiss", (req, res) => handleDismissUpdate(db, req.params.updateId, res));
  return router;
}

function handleListRules(db: Database, res: { json: (body: unknown) => void }): void {
  const rows = db.query(
    `SELECT r.*,
      (SELECT COUNT(*) FROM rule_updates ru
       WHERE ru.rule_id = r.id AND ru.dismissed = 0) as update_available
     FROM rules r
     ORDER BY r.id`,
  ).all();
  res.json(rows);
}

function handleCreateRule(db: Database, body: unknown, res: Res): void {
  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, description, category, severity } = parsed.data;
  const slug = slugify(name);
  const result = db.run(
    "INSERT INTO rules (slug, name, description, category, severity) VALUES (?, ?, ?, ?, ?)",
    [slug, name, description, category, severity],
  );
  const row = db.query("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
  res.json(row);
}

function handleUpdateRule(db: Database, id: string, body: unknown, res: Res): void {
  const parsed = UpdateRuleSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const updates = buildUpdateClauses(parsed.data);
  if (updates.clauses.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  db.run(
    `UPDATE rules SET ${updates.clauses.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...updates.values, id],
  );
  const row = db.query("SELECT * FROM rules WHERE id = ?").get(id);
  row ? res.json(row) : res.status(404).json({ error: "Rule not found" });
}

function buildUpdateClauses(data: z.infer<typeof UpdateRuleSchema>): { clauses: string[]; values: string[] } {
  const clauses: string[] = [];
  const values: string[] = [];
  if (data.name) { clauses.push("name = ?"); values.push(data.name); }
  if (data.description) { clauses.push("description = ?"); values.push(data.description); }
  if (data.category) { clauses.push("category = ?"); values.push(data.category); }
  if (data.severity) { clauses.push("severity = ?"); values.push(data.severity); }
  return { clauses, values };
}

function handleDeleteRule(db: Database, id: string, res: { json: (body: unknown) => void }): void {
  db.run("DELETE FROM rule_updates WHERE rule_id = ?", [id]);
  db.run("DELETE FROM rules WHERE id = ?", [id]);
  res.json({ ok: true });
}

function handleToggleRule(db: Database, id: string, res: Res): void {
  db.run("UPDATE rules SET enabled = 1 - enabled, updated_at = datetime('now') WHERE id = ?", [id]);
  const row = db.query("SELECT * FROM rules WHERE id = ?").get(id);
  row ? res.json(row) : res.status(404).json({ error: "Rule not found" });
}

function handleGetUpdates(db: Database, ruleId: string, res: { json: (body: unknown) => void }): void {
  const rows = db.query(
    "SELECT * FROM rule_updates WHERE rule_id = ? AND dismissed = 0 ORDER BY detected_at DESC",
  ).all(ruleId);
  res.json(rows);
}

function handleAdoptUpdate(db: Database, ruleId: string, updateId: string, res: Res): void {
  const update = db.query("SELECT * FROM rule_updates WHERE id = ?").get(updateId) as {
    id: number; rule_id: number; new_hash: string; new_content: string;
  } | null;

  if (!update) {
    res.status(404).json({ error: "Update not found" });
    return;
  }

  const content = JSON.parse(update.new_content) as {
    name: string; description: string; category: string; severity: string;
  };

  db.run(
    `UPDATE rules SET name = ?, description = ?, category = ?, severity = ?,
     source_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    [content.name, content.description, content.category, content.severity, update.new_hash, ruleId],
  );

  // Dismiss all undismissed updates for this rule
  db.run("UPDATE rule_updates SET dismissed = 1 WHERE rule_id = ? AND dismissed = 0", [ruleId]);

  const row = db.query("SELECT * FROM rules WHERE id = ?").get(ruleId);
  res.json(row);
}

function handleDismissUpdate(db: Database, updateId: string, res: { json: (body: unknown) => void }): void {
  db.run("UPDATE rule_updates SET dismissed = 1 WHERE id = ?", [updateId]);
  res.json({ ok: true });
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
