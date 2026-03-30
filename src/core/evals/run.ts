import { Database } from "bun:sqlite";
import { ConfigError } from "../../types";
import type { EvalRun, EvalReviewerReport } from "../../types";
import { loadAppConfig } from "../config";
import { reviewCode } from "../reviewer";
import { createProvider } from "../reviewer/providers/types";
import { getProfileBySlug, getProfileRules } from "../profiles";
import { buildEvalReviewContext } from "./context";
import { judgeEvalRun } from "./judge";
import { mergeEvalReviewerReports } from "./merge";
import { getEvalFixturesByIds, saveEvalRun } from "./store";

export interface RunEvalInput {
  fixtureIds: number[];
  reviewers: string[];
}

export interface RunEvalDeps {
  db: Database;
}

export async function runEval(
  input: RunEvalInput,
  deps: RunEvalDeps,
): Promise<EvalRun> {
  const fixtures = getEvalFixturesByIds(deps.db, input.fixtureIds);
  if (fixtures.length !== input.fixtureIds.length) {
    throw new ConfigError("One or more eval fixtures were not found");
  }

  const config = loadAppConfig(deps.db);
  const reviewProvider = createProvider({
    provider: config.provider,
    model: config.model,
    apiKey: resolveApiKey(config.provider),
  });
  const judgeProvider = createProvider({
    provider: config.evalProvider,
    model: config.evalModel,
    apiKey: resolveApiKey(config.evalProvider),
  });

  const reviewerReports: EvalReviewerReport[] = [];
  for (const slug of input.reviewers) {
    const profile = getProfileBySlug(deps.db, slug);
    if (!profile || !profile.enabled) {
      throw new ConfigError(`Reviewer profile not found or disabled: ${slug}`);
    }
    const rules = getProfileRules(deps.db, profile.id);
    const context = buildEvalReviewContext({
      taskSummary: buildEvalTaskSummary(fixtures.map((fixture) => fixture.fileName)),
      fixtures,
      rules,
    });
    const report = await reviewCode(context, {
      provider: reviewProvider,
      promptPath: "",
      promptContent: profile.prompt,
      maxDiffLines: config.maxDiffLines,
      chunkSize: config.chunkSize,
    });
    reviewerReports.push({
      reviewerSlug: profile.slug,
      reviewerName: profile.name,
      report,
    });
  }

  const mergedReport = mergeEvalReviewerReports(reviewerReports);
  const allFindings = fixtures.flatMap((fixture) => fixture.findings);
  const judgeResult = await judgeEvalRun(judgeProvider, mergedReport, allFindings);
  return saveEvalRun(deps.db, {
    fixtureIds: input.fixtureIds,
    reviewerSlugs: input.reviewers,
    reviewerReports,
    mergedReport,
    judgeResult,
    judgeProvider: config.evalProvider,
    judgeModel: config.evalModel,
  });
}

function buildEvalTaskSummary(fileNames: string[]): string {
  return `Review the provided eval fixture snippets for correctness, safety, and maintainability issues across these files: ${fileNames.join(", ")}.`;
}

function resolveApiKey(provider: string): string {
  const envKey = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const value = process.env[envKey];
  if (!value) throw new ConfigError(`Missing env var: ${envKey}`, envKey);
  return value;
}
