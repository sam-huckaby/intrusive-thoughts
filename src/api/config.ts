import { Router } from "express";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { readConfigEntries } from "../core/config";

const UpdateConfigSchema = z.record(z.string(), z.string());

export function createConfigRouter(db: Database): Router {
  const router = Router();
  router.get("/", (_req, res) => handleGetConfig(db, res));
  router.put("/", (req, res) => handleUpdateConfig(db, req.body, res));
  return router;
}

function handleGetConfig(
  db: Database,
  res: { json: (body: unknown) => void },
): void {
  res.json(readConfigEntries(db));
}

function handleUpdateConfig(
  db: Database,
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
): void {
  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  upsertConfigValues(db, parsed.data);
  handleGetConfig(db, res);
}

function upsertConfigValues(db: Database, values: Record<string, string>): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(values)) {
    stmt.run(key, value);
  }
}
