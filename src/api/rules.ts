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

export function createRulesRouter(db: Database): Router {
  const router = Router();
  router.get("/", (_req, res) => handleListRules(db, res));
  router.post("/", (req, res) => handleCreateRule(db, req.body, res));
  router.put("/:id", (req, res) => handleUpdateRule(db, req.params.id, req.body, res));
  router.delete("/:id", (req, res) => handleDeleteRule(db, req.params.id, res));
  router.patch("/:id/toggle", (req, res) => handleToggleRule(db, req.params.id, res));
  return router;
}

function handleListRules(db: Database, res: { json: (body: unknown) => void }): void {
  const rows = db.query("SELECT * FROM rules ORDER BY id").all();
  res.json(rows);
}

function handleCreateRule(
  db: Database,
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } ; json: (body: unknown) => void },
): void {
  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { name, description, category, severity } = parsed.data;
  const result = db.run(
    "INSERT INTO rules (name, description, category, severity) VALUES (?, ?, ?, ?)",
    [name, description, category, severity],
  );
  const row = db.query("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
  res.json(row);
}

function handleUpdateRule(
  db: Database,
  id: string,
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } ; json: (body: unknown) => void },
): void {
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

function handleDeleteRule(
  db: Database,
  id: string,
  res: { json: (body: unknown) => void },
): void {
  db.run("DELETE FROM rules WHERE id = ?", [id]);
  res.json({ ok: true });
}

function handleToggleRule(
  db: Database,
  id: string,
  res: { status: (code: number) => { json: (body: unknown) => void } ; json: (body: unknown) => void },
): void {
  db.run("UPDATE rules SET enabled = 1 - enabled, updated_at = datetime('now') WHERE id = ?", [id]);
  const row = db.query("SELECT * FROM rules WHERE id = ?").get(id);
  row ? res.json(row) : res.status(404).json({ error: "Rule not found" });
}
