import { Router } from "express";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { runEval } from "../core/evals/run";
import {
  createEvalFixture,
  deleteEvalFixture,
  getEvalFixture,
  getEvalRun,
  listEvalFixtures,
  listEvalRuns,
  updateEvalFixture,
} from "../core/evals/store";

const FindingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["critical", "warning", "suggestion"]),
  lineHint: z.string().default(""),
  required: z.boolean(),
  tags: z.array(z.string()).default([]),
});

const FixtureSchema = z.object({
  name: z.string().min(1),
  fileName: z.string().min(1),
  language: z.string().default(""),
  category: z.string().default(""),
  code: z.string().min(1),
  notes: z.string().default(""),
  findings: z.array(FindingSchema),
});

const RunEvalSchema = z.object({
  fixtureIds: z.array(z.number().int().positive()).min(1),
  reviewers: z.array(z.string().min(1)).min(1),
});

export function createEvalsRouter(db: Database): Router {
  const router = Router();
  router.get("/fixtures", (_req, res) => res.json(listEvalFixtures(db)));
  router.post("/fixtures", (req, res) => handleCreateFixture(db, req.body, res));
  router.get("/fixtures/:id", (req, res) => handleGetFixture(db, req.params.id, res));
  router.put("/fixtures/:id", (req, res) => handleUpdateFixture(db, req.params.id, req.body, res));
  router.delete("/fixtures/:id", (req, res) => handleDeleteFixture(db, req.params.id, res));
  router.post("/run", (req, res) => handleRunEval(db, req.body, res));
  router.get("/runs", (_req, res) => res.json(listEvalRuns(db)));
  router.get("/runs/:id", (req, res) => handleGetRun(db, req.params.id, res));
  return router;
}

function handleCreateFixture(
  db: Database,
  body: unknown,
  res: ResponseLike,
): void {
  const parsed = FixtureSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(createEvalFixture(db, parsed.data));
}

function handleGetFixture(db: Database, id: string, res: ResponseLike): void {
  const fixture = getEvalFixture(db, Number(id));
  fixture ? res.json(fixture) : res.status(404).json({ error: "Eval fixture not found" });
}

function handleUpdateFixture(
  db: Database,
  id: string,
  body: unknown,
  res: ResponseLike,
): void {
  const parsed = FixtureSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const fixture = updateEvalFixture(db, Number(id), parsed.data);
  fixture ? res.json(fixture) : res.status(404).json({ error: "Eval fixture not found" });
}

function handleDeleteFixture(db: Database, id: string, res: ResponseLike): void {
  const deleted = deleteEvalFixture(db, Number(id));
  deleted ? res.json({ ok: true }) : res.status(404).json({ error: "Eval fixture not found" });
}

async function handleRunEval(
  db: Database,
  body: unknown,
  res: ResponseLike,
): Promise<void> {
  const parsed = RunEvalSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const run = await runEval(parsed.data, { db });
    res.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
}

function handleGetRun(db: Database, id: string, res: ResponseLike): void {
  const run = getEvalRun(db, Number(id));
  run ? res.json(run) : res.status(404).json({ error: "Eval run not found" });
}

interface ResponseLike {
  json: (body: unknown) => void;
  status: (code: number) => { json: (body: unknown) => void };
}
