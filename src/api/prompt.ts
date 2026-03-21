import { Router } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { z } from "zod";

const UpdatePromptSchema = z.object({
  content: z.string().min(1),
});

export function createPromptRouter(
  promptPath: string,
  userConfigDir: string | null,
): Router {
  const router = Router();
  router.get("/", (_req, res) => handleGetPrompt(promptPath, res));
  router.put("/", (req, res) => handleUpdatePrompt(userConfigDir, req.body, res));
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
  userConfigDir: string | null,
  body: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
): Promise<void> {
  const parsed = UpdatePromptSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!userConfigDir) {
    res.status(400).json({
      error: "No writable config directory available. Set HOME or INTRUSIVE_THOUGHTS_CONFIG_DIR.",
    });
    return;
  }

  const writePath = join(userConfigDir, "code-review.md");
  await mkdir(dirname(writePath), { recursive: true });
  await writeFile(writePath, parsed.data.content, "utf-8");
  res.json({ ok: true });
}
