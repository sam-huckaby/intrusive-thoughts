import { readFile } from "fs/promises";
import type { ReviewContext, ReviewResult, DiffChunk, ChangedFile } from "../../types";
import type { CommentThreadWithMessages } from "../changes/comments";
import { formatRulesForPrompt } from "../rules/engine";

export interface PromptVariables {
  task_summary: string;
  rules: string;
  diff: string;
  changed_files: string;
  stats: string;
  is_chunk: string;
  chunk_info: string;
  previous_reviews: string;
  user_comments: string;
  orphaned_user_comments: string;
}

export interface PromptCommentOptions {
  userComments?: CommentThreadWithMessages[];
  orphanedUserComments?: CommentThreadWithMessages[];
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
export function buildPromptVariables(
  context: ReviewContext,
  previousReviews?: ReviewResult[],
  commentOptions?: PromptCommentOptions,
): PromptVariables {
  return {
    task_summary: context.taskSummary,
    rules: formatRulesForPrompt(context.rules),
    diff: context.diff,
    changed_files: formatFileList(context.changedFiles),
    stats: formatStats(context.stats),
    is_chunk: "false",
    chunk_info: "",
    previous_reviews: formatPreviousReviews(previousReviews),
    user_comments: formatUserComments(commentOptions?.userComments),
    orphaned_user_comments: formatUserComments(commentOptions?.orphanedUserComments, true),
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
  previousReviews?: ReviewResult[],
  commentOptions?: PromptCommentOptions,
): PromptVariables {
  return {
    task_summary: context.taskSummary,
    rules: formatRulesForPrompt(context.rules),
    diff: chunk.diff,
    changed_files: formatFileList(chunk.files),
    stats: formatStats(chunk.stats),
    is_chunk: "true",
    chunk_info: `Reviewing chunk ${chunkIndex + 1} of ${totalChunks}`,
    previous_reviews: formatPreviousReviews(previousReviews),
    user_comments: formatUserComments(commentOptions?.userComments),
    orphaned_user_comments: formatUserComments(commentOptions?.orphanedUserComments, true),
  };
}

/**
 * Formats previous review results into a concise summary for the LLM prompt.
 * Includes verdict, summary, and comments from each prior round so the
 * reviewer can avoid contradictions and repetition.
 */
export function formatPreviousReviews(reviews?: ReviewResult[]): string {
  if (!reviews || reviews.length === 0) {
    return "This is the first review of this session. No previous reviews exist.";
  }

  return reviews
    .map((review, index) => {
      const lines = [
        `### Round ${index + 1} — ${review.verdict === "approve" ? "Approved" : "Changes Requested"}`,
        "",
        `**Summary:** ${review.summary}`,
      ];

      if (review.comments.length > 0) {
        lines.push("", "**Comments:**");
        for (const comment of review.comments) {
          const location = comment.line
            ? `${comment.file}:${comment.line}`
            : comment.file;
          lines.push(`- [${comment.severity}] ${location} — ${comment.comment}`);
        }
      }

      if (review.suggestions.length > 0) {
        lines.push("", "**Suggestions:**");
        for (const suggestion of review.suggestions) {
          lines.push(`- ${suggestion}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatFileList(files: ChangedFile[]): string {
  return files
    .map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join("\n");
}

function formatStats(stats: { totalAdditions: number; totalDeletions: number; filesChanged: number }): string {
  return `${stats.filesChanged} files changed, +${stats.totalAdditions} additions, -${stats.totalDeletions} deletions`;
}

export function formatUserComments(
  threads?: CommentThreadWithMessages[],
  orphaned = false,
): string {
  if (!threads || threads.length === 0) {
    return orphaned
      ? "No orphaned user comments exist for the current snapshot."
      : "No active user comments exist for the current snapshot.";
  }

  return threads.map((thread, index) => {
    const lines = [
      `### User Comment ${index + 1}`,
      `**Location:** ${formatThreadLocation(thread)}`,
      `**State:** ${thread.state}`,
    ];
    if (thread.orphanedReason) {
      lines.push(`**Orphaned Reason:** ${thread.orphanedReason}`);
    }

    const [root, ...replies] = thread.messages;
    if (root) {
      lines.push(`**Instruction:** ${root.body}`);
    }
    if (replies.length > 0) {
      lines.push("**Thread:**");
      for (const message of replies) {
        lines.push(`- ${message.authorType}: ${message.body}`);
      }
    }
    return lines.join("\n");
  }).join("\n\n");
}

function formatThreadLocation(thread: CommentThreadWithMessages): string {
  if (thread.anchorKind === "file") return thread.filePath;
  if (thread.anchorKind === "line") return `${thread.filePath}:${thread.startLine}`;
  return `${thread.filePath}:${thread.startLine}-${thread.endLine}`;
}
