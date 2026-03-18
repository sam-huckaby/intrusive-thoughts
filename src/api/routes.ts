import type { Express } from "express";
import { Database } from "bun:sqlite";
import { createRulesRouter } from "./rules";
import { createConfigRouter } from "./config";
import { createPromptRouter } from "./prompt";
import { createReviewsRouter } from "./reviews";
import { createProfilesRouter } from "./profiles";

/**
 * Mounts all API route groups onto the Express app.
 * @sideeffect Registers routes on the Express app
 */
export function mountRoutes(
  app: Express,
  db: Database,
  promptPath: string,
): void {
  app.use("/api/rules", createRulesRouter(db));
  app.use("/api/config", createConfigRouter(db));
  app.use("/api/prompt", createPromptRouter(promptPath));
  app.use("/api/reviews", createReviewsRouter(db, promptPath));
  app.use("/api/profiles", createProfilesRouter(db));
}
