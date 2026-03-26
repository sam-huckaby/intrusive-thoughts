import { Database } from "bun:sqlite";
import type { ReviewResult, AppConfig } from "../types";
import { ConfigError } from "../types";
import { getGitDiff } from "./context/git";
import { buildReviewContext } from "./context/builder";
import { getEnabledRules } from "./rules/engine";
import { createProvider } from "./reviewer/providers/types";
import { reviewCode } from "./reviewer/index";
import { getPromptCommentContext } from "./changes/comments";
import { getSnapshotHeadSha } from "./changes/snapshots";

export interface RunReviewInput {
  taskSummary: string;
  baseBranch?: string;
  workingDirectory?: string;
  previousReviews?: ReviewResult[];
}

export interface RunReviewDeps {
  db: Database;
  promptPath: string;
}

/**
 * THE main entry point. All three interfaces (MCP, CLI, REST API) call this.
 * @sideeffect Reads DB, runs git, calls LLM, writes review to DB
 * @throws {GitError} if git operations fail
 * @throws {ConfigError} if required config is missing
 * @throws {ProviderError} if LLM call fails
 * @throws {ParseError} if LLM response is unparseable
 */
export async function runReview(
  input: RunReviewInput,
  deps: RunReviewDeps,
): Promise<ReviewResult> {
  const config = loadConfig(deps.db);
  const baseBranch = input.baseBranch ?? config.baseBranch;
  const workDir = input.workingDirectory ?? process.cwd();
  const gitResult = await getGitDiff(workDir, baseBranch);
  const headSha = getSnapshotHeadSha(workDir);
  const promptComments = getPromptCommentContext(deps.db, baseBranch, headSha);
  const rules = getEnabledRules(deps.db);
  const context = buildReviewContext({
    taskSummary: input.taskSummary,
    baseBranch,
    workingDirectory: workDir,
    gitResult,
    rules,
  });
  const provider = createProvider({
    provider: config.provider,
    model: config.model,
    apiKey: resolveApiKey(config.provider),
  });
  const result = await reviewCode(context, {
    provider,
    promptPath: deps.promptPath,
    maxDiffLines: config.maxDiffLines,
    chunkSize: config.chunkSize,
    previousReviews: input.previousReviews,
    promptComments,
  });
  saveReview(deps.db, input, baseBranch, result, gitResult.files, config);
  return result;
}

function loadConfig(db: Database): AppConfig {
  const rows = db.query("SELECT key, value FROM config").all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    provider: (map.get("provider") ?? "anthropic") as AppConfig["provider"],
    model: map.get("model") ?? "claude-sonnet-4-20250514",
    baseBranch: map.get("baseBranch") ?? "main",
    maxDiffLines: Number(map.get("maxDiffLines") ?? "5000"),
    chunkSize: Number(map.get("chunkSize") ?? "10"),
    httpPort: Number(map.get("httpPort") ?? "3456"),
    maxReviewRounds: Number(map.get("maxReviewRounds") ?? "5"),
    fallbackProfile: map.get("fallbackProfile") ?? "general",
  };
}

function resolveApiKey(provider: string): string {
  const envKey = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const value = process.env[envKey];
  if (!value) throw new ConfigError(`Missing env var: ${envKey}`, envKey);
  return value;
}

function saveReview(
  db: Database,
  input: RunReviewInput,
  baseBranch: string,
  result: ReviewResult,
  files: Array<{ path: string }>,
  config: AppConfig,
): void {
  db.run(
    `INSERT INTO reviews (task_summary, base_branch, verdict, result_json, files_reviewed, provider, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.taskSummary,
      baseBranch,
      result.verdict,
      JSON.stringify(result),
      JSON.stringify(files.map((f) => f.path)),
      config.provider,
      config.model,
    ],
  );
}
