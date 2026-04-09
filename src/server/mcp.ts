import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Database } from "bun:sqlite";
import type {
  AppConfig,
  ReviewerProfile,
  ProfileReviewResult,
  AcceptedProfile,
} from "../types";
import { ConfigError } from "../types";
import { getGitDiff } from "../core/context/git";
import { buildReviewContext } from "../core/context/builder";
import { createProvider } from "../core/reviewer/providers/types";
import { reviewCode } from "../core/reviewer/index";
import {
  getEnabledProfiles,
  getProfileBySlug,
  getFallbackProfile,
  getProfileRules,
} from "../core/profiles/index";
import { matchProfiles, getMatchingFiles } from "../core/profiles/matcher";
import {
  ReviewSession,
  hashDiff,
} from "./session";
import type { SessionMetadata } from "./session";
import { loadAppConfig } from "../core/config";

export interface McpServerOptions {
  db: Database;
  promptPath: string;
}

export interface McpReviewResponse {
  reviews: ProfileReviewResult[] | null;
  accepted: AcceptedProfile[];
  allAccepted: boolean;
  fallbackUsed: boolean;
  fallbackWarning: string | null;
  session: SessionMetadata;
}

/**
 * Creates and starts the MCP server over stdio transport.
 * Registers the `review_code` tool.
 * This function blocks (runs the stdio event loop) until the client disconnects.
 * @sideeffect Binds to stdio, runs review pipeline
 */
export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const server = createMcpServerInstance(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function createMcpServerInstance(options: McpServerOptions): McpServer {
  const server = new McpServer({
    name: "intrusive-thoughts",
    version: "0.1.0",
  });
  const session = createSession(options.db);
  registerReviewTool(server, options, session);
  return server;
}

/**
 * Reads maxReviewRounds from the config table and creates a ReviewSession.
 * The session lives for the lifetime of the MCP server process.
 */
function createSession(db: Database): ReviewSession {
  const row = db.query("SELECT value FROM config WHERE key = ?").get("maxReviewRounds") as
    | { value: string }
    | null;
  const maxRounds = Number(row?.value ?? "5");
  return new ReviewSession(maxRounds);
}

function registerReviewTool(
  server: McpServer,
  options: McpServerOptions,
  session: ReviewSession,
): void {
  server.tool(
    "review_code",
    {
      taskSummary: z.string().describe(
        "Summary of the task/changes, compiled from user messages to the agent",
      ),
      baseBranch: z.string().optional().describe(
        "Branch to diff against. Defaults to configured base branch (usually 'main')",
      ),
      workingDirectory: z.string().optional().describe(
        "Path to the git repository. Defaults to the current working directory",
      ),
      reviewers: z.array(z.string()).optional().describe(
        "Specific reviewer profile slugs to use. If omitted, profiles are selected " +
          "automatically by file-pattern matching.",
      ),
    },
    async ({ taskSummary, baseBranch, workingDirectory, reviewers }) =>
      handleReviewTool(options, session, taskSummary, baseBranch, workingDirectory, reviewers),
  );
}

async function handleReviewTool(
  options: McpServerOptions,
  session: ReviewSession,
  taskSummary: string,
  baseBranch?: string,
  workingDirectory?: string,
  reviewers?: string[],
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Check rounds
  if (!session.hasRoundsRemaining()) {
    return jsonResponse({
      reviews: null,
      accepted: buildAcceptedList(session),
      allAccepted: session.isAllAccepted(),
      fallbackUsed: false,
      fallbackWarning: null,
      session: session.buildSessionMetadata(),
    });
  }

  // Check if all accepted
  if (session.isAllAccepted() && session.getRoundNumber() > 0) {
    return jsonResponse({
      reviews: [],
      accepted: buildAcceptedList(session),
      allAccepted: true,
      fallbackUsed: false,
      fallbackWarning: null,
      session: {
        ...session.buildSessionMetadata(),
        instructions: "All reviewers have approved your changes. No further review rounds are needed.",
      },
    });
  }

  const config = loadAppConfig(options.db);
  const resolvedBaseBranch = baseBranch ?? config.baseBranch;
  const workDir = workingDirectory ?? process.cwd();

  // Get git diff
  const gitResult = await getGitDiff(workDir, resolvedBaseBranch);
  const changedFilePaths = gitResult.files.map((f) => f.path);

  // Resolve profiles
  const {
    profiles: matchedProfiles,
    fallbackUsed,
    fallbackWarning,
  } = resolveProfiles(options.db, changedFilePaths, reviewers);

  // Compute per-profile diff hashes for re-trigger detection
  const diffHashes = new Map<string, string>();
  for (const profile of matchedProfiles) {
    const matchingFiles = getMatchingFiles(profile.filePatterns, changedFilePaths);
    // Hash the matching file paths + full diff as a proxy for "relevant diff"
    // (A more precise implementation would extract only the diff sections for matching files)
    const hashInput = matchingFiles.sort().join("\n") + "\n---\n" + gitResult.diff;
    diffHashes.set(profile.slug, hashDiff(hashInput));
  }

  // Filter through session state (skip accepted, detect re-triggers)
  const { active: activeSlugs, reTriggered } = session.getActiveProfiles(
    matchedProfiles.map((p) => p.slug),
    diffHashes,
  );

  const activeProfiles = matchedProfiles.filter((p) => activeSlugs.includes(p.slug));

  // If no profiles to run after filtering
  if (activeProfiles.length === 0 && session.isAllAccepted()) {
    return jsonResponse({
      reviews: [],
      accepted: buildAcceptedList(session),
      allAccepted: true,
      fallbackUsed,
      fallbackWarning,
      session: {
        ...session.buildSessionMetadata(),
        instructions: "All reviewers have approved your changes. No further review rounds are needed.",
      },
    });
  }

  // Create LLM provider
  const provider = createProvider({
    provider: config.provider,
    model: config.model,
    apiKey: resolveApiKey(config.provider),
  });

  // Run each active profile
  const profileResults: ProfileReviewResult[] = [];
  const roundResults: Array<{
    slug: string;
    review: import("../types").ReviewResult;
    matchingFiles: string[];
    diffHash: string;
  }> = [];

  for (const profile of activeProfiles) {
    const rules = getProfileRules(options.db, profile.id);
    const context = buildReviewContext({
      taskSummary,
      baseBranch: resolvedBaseBranch,
      workingDirectory: workDir,
      gitResult,
      rules,
    });

    // Get previous reviews for this specific profile
    const previousReviews = session.getPreviousReviewsForProfile(profile.slug);

    // If re-triggered, prepend follow-up context
    let effectivePreviousReviews = previousReviews;
    const profileState = session.getProfileState(profile.slug);
    const isFollowUp = reTriggered.has(profile.slug);
    const previouslyAcceptedAtRound = isFollowUp
      ? (profileState?.acceptedAtRound ?? null)
      : null;

    const review = await reviewCode(context, {
      provider,
      promptPath: options.promptPath,
      promptContent: profile.prompt,
      maxDiffLines: config.maxDiffLines,
      chunkSize: config.chunkSize,
      previousReviews: effectivePreviousReviews,
    });

    const matchingFiles = getMatchingFiles(profile.filePatterns, changedFilePaths);
    const diffHash = diffHashes.get(profile.slug) ?? "";

    profileResults.push({
      profile: profile.slug,
      profileName: profile.name,
      review,
      isFollowUp,
      previouslyAcceptedAtRound,
    });

    roundResults.push({
      slug: profile.slug,
      review,
      matchingFiles,
      diffHash,
    });

    // Save to DB
    saveReview(options.db, taskSummary, resolvedBaseBranch, review, profile, gitResult.files, config);
  }

  // Record round in session
  session.recordRound(roundResults);

  const response: McpReviewResponse = {
    reviews: profileResults,
    accepted: buildAcceptedList(session),
    allAccepted: session.isAllAccepted(),
    fallbackUsed,
    fallbackWarning,
    session: session.buildSessionMetadata(),
  };

  return jsonResponse(response);
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
  if (explicitReviewers && explicitReviewers.length > 0) {
    const profiles = explicitReviewers
      .map((slug) => getProfileBySlug(db, slug))
      .filter((p): p is ReviewerProfile => p !== null && p.enabled);

    return { profiles, fallbackUsed: false, fallbackWarning: null };
  }

  const enabled = getEnabledProfiles(db);
  const matched = matchProfiles(enabled, changedFilePaths);

  if (matched.length > 0) {
    return { profiles: matched, fallbackUsed: false, fallbackWarning: null };
  }

  const fallback = getFallbackProfile(db);
  if (fallback && fallback.enabled) {
    return {
      profiles: [fallback],
      fallbackUsed: true,
      fallbackWarning: `No reviewer profiles matched the changed files. Using the fallback '${fallback.slug}' profile.`,
    };
  }

  return {
    profiles: [],
    fallbackUsed: true,
    fallbackWarning:
      "No reviewer profiles matched the changed files, and the configured fallback profile was not found.",
  };
}

// ─── Helpers ─────────────────────────────────────────────

function buildAcceptedList(session: ReviewSession): AcceptedProfile[] {
  // We don't have profileName readily available from session state, so we store slug only.
  // The full AcceptedProfile with name would require a DB lookup.
  // For now, use slug as both profile and profileName.
  return session.getAcceptedProfiles().map((a) => ({
    profile: a.slug,
    profileName: a.slug,
    acceptedAtRound: a.acceptedAtRound,
  }));
}

function resolveApiKey(provider: string): string {
  const envKey = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const value = process.env[envKey];
  if (!value) throw new ConfigError(`Missing env var: ${envKey}`, envKey);
  return value;
}

function saveReview(
  db: Database,
  taskSummary: string,
  baseBranch: string,
  result: import("../types").ReviewResult,
  profile: ReviewerProfile,
  files: Array<{ path: string }>,
  config: AppConfig,
): void {
  db.run(
    `INSERT INTO reviews (task_summary, base_branch, verdict, result_json, files_reviewed, provider, model)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      taskSummary,
      baseBranch,
      result.verdict,
      JSON.stringify({
        profile: profile.slug,
        profileName: profile.name,
        ...result,
      }),
      JSON.stringify(files.map((f) => f.path)),
      config.provider,
      config.model,
    ],
  );
}

function jsonResponse(
  data: McpReviewResponse,
): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
