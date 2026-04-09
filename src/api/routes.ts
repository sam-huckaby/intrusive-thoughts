import type { Express } from "express";
import { Database } from "bun:sqlite";
import { createRulesRouter } from "./rules";
import { createConfigRouter } from "./config";
import { createPromptRouter } from "./prompt";
import { createReviewsRouter } from "./reviews";
import { createProfilesRouter } from "./profiles";
import { createChangesRouter } from "./changes";
import { createEvalsRouter } from "./evals";
import type { RepoContext } from "../core/context/repo";

/**
 * Mounts all API route groups onto the Express app.
 * @sideeffect Registers routes on the Express app
 */
export function mountRoutes(
  app: Express,
  db: Database,
  promptPath: string,
  userConfigDir: string | null,
  repoContext: RepoContext | null,
): void {
  app.use("/api/rules", createRulesRouter(db));
  app.use("/api/config", createConfigRouter(db));
  app.use("/api/prompt", createPromptRouter(promptPath, userConfigDir));
  app.use("/api/reviews", createReviewsRouter(db, promptPath));
  app.use("/api/profiles", createProfilesRouter(db));
  app.use("/api/changes", createChangesRouter(db, repoContext));
  app.use("/api/evals", createEvalsRouter(db));
}
