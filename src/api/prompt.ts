import { Router } from "express";
import { readFile, writeFile } from "fs/promises";
import { z } from "zod";

const UpdatePromptSchema = z.object({
  content: z.string().min(1),
});

export function createPromptRouter(promptPath: string): Router {
  const router = Router();
  router.get("/", (_req, res) => handleGetPrompt(promptPath, res));
  router.put("/", (req, res) => handleUpdatePrompt(promptPath, req.body, res));
  return router;
}

async function handleGetPrompt(
  promptPath: string,
  res: { json: (body: unknown) => void },
): Promise<void> {
  const content = await readFile(promptPath, "utf-8");
  res.json({ content });
}

async function handleUpdatePrompt(
  promptPath: string,
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
): Promise<void> {
  const parsed = UpdatePromptSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await writeFile(promptPath, parsed.data.content, "utf-8");
  res.json({ ok: true });
}
