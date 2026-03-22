import { Database } from "bun:sqlite";
import type {
  AppConfig,
  ReviewResult,
  ReviewerProfile,
  ProfileReviewResult,
  MultiReviewResult,
} from "../types";
import { ConfigError } from "../types";
import { getGitDiff } from "./context/git";
import { buildReviewContext } from "./context/builder";
import { createProvider } from "./reviewer/providers/types";
import { reviewCode } from "./reviewer/index";
import {
  getEnabledProfiles,
  getProfileBySlug,
  getFallbackProfile,
  getProfileRules,
} from "./profiles/index";
import { matchProfiles } from "./profiles/matcher";
import { getPromptCommentContext } from "./changes/comments";
import { getSnapshotHeadSha } from "./changes/snapshots";

export interface MultiReviewInput {
  taskSummary: string;
  baseBranch?: string;
  workingDirectory?: string;
  /** Explicit reviewer slugs. If provided, only these profiles run. */
  reviewers?: string[];
  /** Per-profile previous reviews, keyed by slug. */
  previousReviewsByProfile?: Map<string, ReviewResult[]>;
}

export interface MultiReviewDeps {
  db: Database;
}

/**
 * Multi-profile review orchestration. Replaces runReview() for the MCP pathway.
 *
 * Flow:
 * 1. Load config, run git diff, get changed files.
 * 2. Load enabled profiles, match against changed files.
 * 3. If explicit reviewers are provided, filter to only those.
 * 4. If no profiles match, fall back to the configured fallback profile.
 * 5. For each active profile: load linked rules, build context, run review.
 * 6. Save all reviews to the DB.
 * 7. Return MultiReviewResult.
 *
 * @sideeffect Reads DB, runs git, calls LLM, writes reviews to DB
 */
export async function runMultiReview(
  input: MultiReviewInput,
  deps: MultiReviewDeps,
): Promise<MultiReviewResult> {
  const config = loadConfig(deps.db);
  const baseBranch = input.baseBranch ?? config.baseBranch;
  const workDir = input.workingDirectory ?? process.cwd();

  const gitResult = await getGitDiff(workDir, baseBranch);
  const headSha = getSnapshotHeadSha(workDir);
  const promptComments = getPromptCommentContext(deps.db, baseBranch, headSha);
  const changedFilePaths = gitResult.files.map((f) => f.path);

  // Determine which profiles to run
  const { profiles, fallbackUsed, fallbackWarning } = resolveProfiles(
    deps.db,
    changedFilePaths,
    input.reviewers,
  );

  // Run each profile
  const provider = createProvider({
    provider: config.provider,
    model: config.model,
    apiKey: resolveApiKey(config.provider),
  });

  const results: ProfileReviewResult[] = [];

  for (const profile of profiles) {
    const rules = getProfileRules(deps.db, profile.id);
    const context = buildReviewContext({
      taskSummary: input.taskSummary,
      baseBranch,
      workingDirectory: workDir,
      gitResult,
      rules,
    });

    const previousReviews = input.previousReviewsByProfile?.get(profile.slug);

    const review = await reviewCode(context, {
      provider,
      promptPath: "", // unused when promptContent is set
      promptContent: profile.prompt,
      maxDiffLines: config.maxDiffLines,
      chunkSize: config.chunkSize,
      previousReviews,
      promptComments,
    });

    results.push({
      profile: profile.slug,
      profileName: profile.name,
      review,
      isFollowUp: false,
      previouslyAcceptedAtRound: null,
    });

    saveReview(deps.db, input, baseBranch, review, profile, gitResult.files, config);
  }

  return {
    reviews: results,
    accepted: [], // Acceptance tracking is handled by the session layer (Phase 4)
    allAccepted: false,
    fallbackUsed,
    fallbackWarning,
  };
}

// ─── Profile resolution ──────────────────────────────────

interface ResolvedProfiles {
  profiles: ReviewerProfile[];
  fallbackUsed: boolean;
  fallbackWarning: string | null;
}

function resolveProfiles(
  db: Database,
  changedFilePaths: string[],
  explicitReviewers?: string[],
): ResolvedProfiles {
  // If explicit reviewers are specified, use only those
  if (explicitReviewers && explicitReviewers.length > 0) {
    const profiles = explicitReviewers
      .map((slug) => getProfileBySlug(db, slug))
      .filter((p): p is ReviewerProfile => p !== null && p.enabled);

    return {
      profiles,
      fallbackUsed: false,
      fallbackWarning: null,
    };
  }

  // Automatic matching
  const enabled = getEnabledProfiles(db);
  const matched = matchProfiles(enabled, changedFilePaths);

  if (matched.length > 0) {
    return {
      profiles: matched,
      fallbackUsed: false,
      fallbackWarning: null,
    };
  }

  // No profiles matched — use fallback
  const fallback = getFallbackProfile(db);
  if (fallback && fallback.enabled) {
    return {
      profiles: [fallback],
      fallbackUsed: true,
      fallbackWarning: `No reviewer profiles matched the changed files. Using the fallback '${fallback.slug}' profile.`,
    };
  }

  // No fallback available either
  return {
    profiles: [],
    fallbackUsed: true,
    fallbackWarning:
      "No reviewer profiles matched the changed files, and the configured fallback profile was not found.",
  };
}

// ─── Config & helpers ────────────────────────────────────

function loadConfig(db: Database): AppConfig {
  const rows = db.query("SELECT key, value FROM config").all() as Array<{
    key: string;
    value: string;
  }>;
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
  const envKey =
    provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const value = process.env[envKey];
  if (!value) throw new ConfigError(`Missing env var: ${envKey}`, envKey);
  return value;
}

function saveReview(
  db: Database,
  input: MultiReviewInput,
  baseBranch: string,
  result: ReviewResult,
  profile: ReviewerProfile,
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
      JSON.stringify({ profile: profile.slug, profileName: profile.name, ...result }),
      JSON.stringify(files.map((f) => f.path)),
      config.provider,
      config.model,
    ],
  );
}
