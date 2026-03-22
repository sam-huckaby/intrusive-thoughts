import type {
  ReviewContext,
  ReviewResult,
  ChunkReviewResult,
  DiffChunk,
} from "../../types";
import { ParseError } from "../../types";
import type { LLMProvider } from "./providers/types";
import { parseDiff } from "../context/git";
import { chunkDiff } from "../context/chunker";
import {
  loadPromptTemplate,
  interpolatePrompt,
  buildPromptVariables,
  buildChunkPromptVariables,
  type PromptCommentOptions,
} from "./prompt";

export interface ReviewerOptions {
  provider: LLMProvider;
  promptPath: string;
  /** If set, use this string as the prompt template instead of loading from promptPath. */
  promptContent?: string;
  maxDiffLines: number;
  chunkSize: number;
  previousReviews?: ReviewResult[];
  promptComments?: PromptCommentOptions;
}

/**
 * Performs a complete review of the given context.
 * If the diff fits within maxDiffLines, does a single LLM call.
 * If the diff is too large, chunks it, reviews each chunk,
 * then synthesizes into a single ReviewResult.
 * @sideeffect Reads prompt file, calls LLM provider
 * @throws {ProviderError} if the LLM call fails
 * @throws {ParseError} if the LLM response can't be parsed as valid JSON
 */
export async function reviewCode(
  context: ReviewContext,
  options: ReviewerOptions,
): Promise<ReviewResult> {
  const template = options.promptContent ?? await loadPromptTemplate(options.promptPath);
  const chunks = buildChunks(context, options);
  if (chunks.length <= 1) {
    return performSingleReview(context, template, options.provider, options.previousReviews, options.promptComments);
  }
  return performChunkedReview(context, chunks, template, options.provider, options.previousReviews, options.promptComments);
}

function buildChunks(context: ReviewContext, options: ReviewerOptions): DiffChunk[] {
  const parsed = parseDiff(context.diff);
  return chunkDiff(parsed, {
    maxDiffLines: options.maxDiffLines,
    chunkSize: options.chunkSize,
  });
}

async function performSingleReview(
  context: ReviewContext,
  template: string,
  provider: LLMProvider,
  previousReviews?: ReviewResult[],
  promptComments?: PromptCommentOptions,
): Promise<ReviewResult> {
  const variables = buildPromptVariables(context, previousReviews, promptComments);
  const prompt = interpolatePrompt(template, variables);
  const raw = await provider.call(prompt, "Please review the code changes above.");
  return parseReviewResult(raw);
}

async function performChunkedReview(
  context: ReviewContext,
  chunks: DiffChunk[],
  template: string,
  provider: LLMProvider,
  previousReviews?: ReviewResult[],
  promptComments?: PromptCommentOptions,
): Promise<ReviewResult> {
  const chunkResults: ChunkReviewResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await reviewChunk(context, chunks[i], i, chunks.length, provider, template, previousReviews, promptComments);
    chunkResults.push(result);
  }
  return synthesizeChunkResults(chunkResults, context, provider);
}

/**
 * Reviews a single chunk. Called internally by reviewCode for each chunk.
 * Exported for testing.
 * @sideeffect Calls LLM provider
 * @throws {ProviderError} if the LLM call fails
 * @throws {ParseError} if the LLM response can't be parsed
 */
export async function reviewChunk(
  context: ReviewContext,
  chunk: DiffChunk,
  chunkIndex: number,
  totalChunks: number,
  provider: LLMProvider,
  promptTemplate: string,
  previousReviews?: ReviewResult[],
  promptComments?: PromptCommentOptions,
): Promise<ChunkReviewResult> {
  const variables = buildChunkPromptVariables(context, chunk, chunkIndex, totalChunks, previousReviews, promptComments);
  const prompt = interpolatePrompt(promptTemplate, variables);
  const raw = await provider.call(prompt, "Please review this chunk of code changes.");
  return parseChunkResult(raw);
}

/**
 * Synthesizes multiple chunk results into a single ReviewResult.
 * Makes one final LLM call with all chunk results as input.
 * @sideeffect Calls LLM provider
 * @throws {ProviderError} if the LLM call fails
 * @throws {ParseError} if the synthesis response can't be parsed
 */
export async function synthesizeChunkResults(
  chunkResults: ChunkReviewResult[],
  context: ReviewContext,
  provider: LLMProvider,
): Promise<ReviewResult> {
  const systemPrompt = buildSynthesisSystemPrompt();
  const userMessage = buildSynthesisUserMessage(chunkResults, context);
  const raw = await provider.call(systemPrompt, userMessage);
  return parseReviewResult(raw);
}

function buildSynthesisSystemPrompt(): string {
  return [
    "You are synthesizing multiple code review chunk results into one final review.",
    "Combine all comments, deduplicate, and produce a single coherent verdict.",
    "Respond with JSON matching the ReviewResult schema.",
  ].join(" ");
}

function buildSynthesisUserMessage(
  chunkResults: ChunkReviewResult[],
  context: ReviewContext,
): string {
  const chunks = JSON.stringify(chunkResults, null, 2);
  return `Task: ${context.taskSummary}\n\nChunk results:\n${chunks}`;
}

/**
 * Parses a raw LLM response string into a ReviewResult.
 * Handles JSON extraction from markdown code blocks if needed.
 * @throws {ParseError} if JSON is invalid or missing required fields
 */
export function parseReviewResult(raw: string): ReviewResult {
  const json = extractJson(raw);
  const parsed = safeParse(json);
  return validateReviewResult(parsed);
}

/**
 * Parses a raw LLM response string into a ChunkReviewResult.
 * @throws {ParseError} if JSON is invalid or missing required fields
 */
export function parseChunkResult(raw: string): ChunkReviewResult {
  const json = extractJson(raw);
  const parsed = safeParse(json);
  return validateChunkResult(parsed);
}

function extractJson(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new ParseError("Invalid JSON in LLM response", json);
  }
}

function validateReviewResult(parsed: unknown): ReviewResult {
  if (!isObject(parsed)) throw new ParseError("Response is not an object");
  const obj = parsed as Record<string, unknown>;
  if (!isValidVerdict(obj.verdict)) {
    throw new ParseError("Missing or invalid 'verdict' field");
  }
  return {
    verdict: obj.verdict as ReviewResult["verdict"],
    summary: typeof obj.summary === "string" ? obj.summary : "",
    comments: Array.isArray(obj.comments) ? obj.comments as ReviewResult["comments"] : [],
    suggestions: Array.isArray(obj.suggestions) ? obj.suggestions as string[] : [],
    confidence: clampConfidence(obj.confidence),
  };
}

function validateChunkResult(parsed: unknown): ChunkReviewResult {
  if (!isObject(parsed)) throw new ParseError("Response is not an object");
  const obj = parsed as Record<string, unknown>;
  return {
    chunkId: typeof obj.chunkId === "number" ? obj.chunkId : 0,
    comments: Array.isArray(obj.comments) ? obj.comments as ChunkReviewResult["comments"] : [],
    issues: Array.isArray(obj.issues) ? obj.issues as string[] : [],
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidVerdict(v: unknown): boolean {
  return v === "approve" || v === "request_changes";
}

function clampConfidence(v: unknown): number {
  if (typeof v !== "number") return 0.5;
  return Math.max(0, Math.min(1, v));
}
