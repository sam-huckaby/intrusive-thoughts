import express from "express";
import type { Express } from "express";
import cors from "cors";
import { Database } from "bun:sqlite";
import { join } from "path";
import { mountRoutes } from "../api/routes";
import type { RepoContext } from "../core/context/repo";

export interface HttpServerOptions {
  db: Database;
  promptPath: string;
  staticDir?: string;
  port?: number;
  /** Writable user config directory for prompt edits (null if unavailable) */
  userConfigDir?: string | null;
  /** Active repo context for repo-scoped web features */
  repoContext?: RepoContext | null;
}

/**
 * Creates and configures the Express app with all middleware,
 * API routes, and static file serving. Does NOT call listen().
 * Exported separately so tests can use supertest against the app.
 */
export function createApp(options: HttpServerOptions): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  mountRoutes(app, options.db, options.promptPath, options.userConfigDir ?? null, options.repoContext ?? null);
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    serveFallback(app, options.staticDir);
  }
  return app;
}

function serveFallback(app: Express, staticDir: string): void {
  app.get("*", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });
}

/**
 * Creates the app and starts listening on the configured port.
 * Logs the URL to stdout.
 * @sideeffect Binds to network port, logs to stdout
 */
export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const app = createApp(options);
  const port = options.port ?? 3456;
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`intrusive-thoughts web UI: http://localhost:${port}`);
      resolve();
    });
  });
}
