import { parseArgs } from "./cli";
import { openDatabase } from "./db/index";
import { runMultiReview } from "./core/review-multi";
import { startHttpServer } from "./server/http";
import { startMcpServer } from "./server/mcp";
import { seedRules } from "./db/seed-rules";
import { seedProfiles } from "./db/seed-profiles";
import { resolvePaths } from "./paths";
import { resolveRepoContext } from "./core/context/repo";

/**
 * Main entrypoint. Detects mode from CLI args and starts
 * the appropriate server/runner.
 * @sideeffect Opens DB, binds network/stdio, reads/writes files
 */
export async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const paths = resolvePaths({
    workingDirectory: args.dir,
    ephemeral: args.ephemeral,
  });

  const db = openDatabase(paths.dbPath);
  await seedRules(db, paths.rulesDirs);
  await seedProfiles(db, paths.reviewersDirs);

  switch (args.mode) {
    case "review": return handleReviewMode(args, db);
    case "serve": return handleServeMode(args, db, paths.promptPath, paths.staticDir, paths.userConfigDir);
    case "mcp": return startMcpServer({ db, promptPath: paths.promptPath });
  }
}

async function handleReviewMode(
  args: ReturnType<typeof parseArgs>,
  db: ReturnType<typeof openDatabase>,
): Promise<void> {
  const taskSummary = requireTaskSummary(args.summary);
  const result = await runMultiReview(
    {
      taskSummary,
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
  staticDir: string,
  userConfigDir: string | null,
): Promise<void> {
  const repoContext = await resolveRepoContext(process.cwd());
  await startHttpServer({
    db,
    promptPath,
    staticDir,
    port: args.port,
    userConfigDir,
    repoContext,
  });
}

function requireTaskSummary(summary?: string): string {
  if (summary) return summary;
  console.error("Error: --summary is required for review mode");
  process.exit(1);
  throw new Error("unreachable");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
