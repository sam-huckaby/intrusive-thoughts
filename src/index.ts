import { join } from "path";
import { parseArgs } from "./cli";
import { openDatabase, getDefaultDbPath } from "./db/index";
import { runMultiReview } from "./core/review-multi";
import { startHttpServer } from "./server/http";
import { startMcpServer } from "./server/mcp";
import { seedDefaultRules } from "./db/seed";
import { seedProfiles } from "./db/seed-profiles";

/**
 * Main entrypoint. Detects mode from CLI args and starts
 * the appropriate server/runner.
 * @sideeffect Opens DB, binds network/stdio, reads/writes files
 */
export async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const db = openDatabase(getDefaultDbPath());
  seedDefaultRules(db);
  await seedProfiles(db, resolveReviewersDir());
  const promptPath = resolvePromptPath();
  switch (args.mode) {
    case "review": return handleReviewMode(args, db, promptPath);
    case "serve": return handleServeMode(args, db, promptPath);
    case "mcp": return startMcpServer({ db, promptPath });
  }
}

function resolvePromptPath(): string {
  return join(import.meta.dir, "..", "prompts", "code-review.md");
}

function resolveReviewersDir(): string {
  return join(import.meta.dir, "..", "prompts", "reviewers");
}

async function handleReviewMode(
  args: ReturnType<typeof parseArgs>,
  db: ReturnType<typeof openDatabase>,
  _promptPath: string,
): Promise<void> {
  if (!args.summary) {
    console.error("Error: --summary is required for review mode");
    process.exit(1);
  }
  const result = await runMultiReview(
    {
      taskSummary: args.summary,
      baseBranch: args.baseBranch,
      workingDirectory: args.dir,
      reviewers: args.reviewers,
    },
    { db },
  );
  console.log(JSON.stringify(result, null, 2));
}

async function handleServeMode(
  args: ReturnType<typeof parseArgs>,
  db: ReturnType<typeof openDatabase>,
  promptPath: string,
): Promise<void> {
  const staticDir = join(import.meta.dir, "..", "web", "dist");
  await startHttpServer({ db, promptPath, staticDir, port: args.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
