import { Router } from "express";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { runReview } from "../core/review";

const RunReviewSchema = z.object({
  taskSummary: z.string().min(1),
  baseBranch: z.string().optional(),
  workingDirectory: z.string().optional(),
});

export function createReviewsRouter(db: Database, promptPath: string): Router {
  const router = Router();
  router.get("/", (_req, res) => handleListReviews(db, res));
  router.get("/:id", (req, res) => handleGetReview(db, req.params.id, res));
  router.post("/run", (req, res) => handleRunReview(db, promptPath, req.body, res));
  return router;
}

function handleListReviews(
  db: Database,
  res: { json: (body: unknown) => void },
): void {
  const rows = db
    .query("SELECT id, task_summary, base_branch, verdict, files_reviewed, provider, model, chunks_used, created_at FROM reviews ORDER BY id DESC")
    .all();
  res.json(rows);
}

function handleGetReview(
  db: Database,
  id: string,
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
): void {
  const row = db.query("SELECT * FROM reviews WHERE id = ?").get(id);
  row ? res.json(row) : res.status(404).json({ error: "Review not found" });
}

async function handleRunReview(
  db: Database,
  promptPath: string,
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
): Promise<void> {
  const parsed = RunReviewSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await runReview(parsed.data, { db, promptPath });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}
