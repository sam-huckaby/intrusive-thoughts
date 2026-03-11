import { readFile } from "fs/promises";
import type { ReviewContext, DiffChunk, ChangedFile } from "../../types";
import { formatRulesForPrompt } from "../rules/engine";

export interface PromptVariables {
  task_summary: string;
  rules: string;
  diff: string;
  changed_files: string;
  stats: string;
  is_chunk: string;
  chunk_info: string;
}

/**
 * Reads the prompt template file from disk.
 * @sideeffect Reads from filesystem
 * @param promptPath - absolute path to the .md file
 * @returns raw template string with {{variable}} placeholders
 */
export async function loadPromptTemplate(promptPath: string): Promise<string> {
  return readFile(promptPath, "utf-8");
}

/**
 * Replaces all {{variable}} placeholders in the template
 * with corresponding values from the variables object.
 * Unknown placeholders are left as-is.
 * Pure function — no I/O.
 */
export function interpolatePrompt(
  template: string,
  variables: PromptVariables,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key as keyof PromptVariables];
    return value !== undefined ? value : match;
  });
}

/**
 * Builds PromptVariables from a ReviewContext for a full (non-chunked) review.
 */
export function buildPromptVariables(context: ReviewContext): PromptVariables {
  return {
    task_summary: context.taskSummary,
    rules: formatRulesForPrompt(context.rules),
    diff: context.diff,
    changed_files: formatFileList(context.changedFiles),
    stats: formatStats(context.stats),
    is_chunk: "false",
    chunk_info: "",
  };
}

/**
 * Builds PromptVariables for a single chunk review.
 */
export function buildChunkPromptVariables(
  context: ReviewContext,
  chunk: DiffChunk,
  chunkIndex: number,
  totalChunks: number,
): PromptVariables {
  return {
    task_summary: context.taskSummary,
    rules: formatRulesForPrompt(context.rules),
    diff: chunk.diff,
    changed_files: formatFileList(chunk.files),
    stats: formatStats(chunk.stats),
    is_chunk: "true",
    chunk_info: `Reviewing chunk ${chunkIndex + 1} of ${totalChunks}`,
  };
}

function formatFileList(files: ChangedFile[]): string {
  return files
    .map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join("\n");
}

function formatStats(stats: { totalAdditions: number; totalDeletions: number; filesChanged: number }): string {
  return `${stats.filesChanged} files changed, +${stats.totalAdditions} additions, -${stats.totalDeletions} deletions`;
}
