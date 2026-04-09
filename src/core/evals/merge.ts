import type {
  EvalMergedComment,
  EvalMergedFindingSource,
  EvalMergedReport,
  EvalMergedSuggestion,
  EvalReviewerReport,
  FileComment,
} from "../../types";

const SEVERITY_ORDER: Record<FileComment["severity"], number> = {
  critical: 0,
  warning: 1,
  suggestion: 2,
  nitpick: 3,
};

const FILLER_PATTERNS = [
  /\bconsider\b/g,
  /\bplease\b/g,
  /\bit looks like\b/g,
  /\byou should\b/g,
  /\bthis should\b/g,
  /\bprobably\b/g,
];

export function mergeEvalReviewerReports(reports: EvalReviewerReport[]): EvalMergedReport {
  const comments = mergeComments(reports);
  const suggestions = mergeSuggestions(reports);
  return {
    verdict: reports.some((report) => report.report.verdict === "request_changes")
      ? "request_changes"
      : "approve",
    summary: buildMergedSummary(reports),
    comments,
    suggestions,
    confidence: reports.length === 0
      ? 0
      : Number((reports.reduce((sum, report) => sum + report.report.confidence, 0) / reports.length).toFixed(3)),
  };
}

function mergeComments(reports: EvalReviewerReport[]): EvalMergedComment[] {
  const merged: EvalMergedComment[] = [];
  for (const report of reports) {
    report.report.comments.forEach((comment, originalIndex) => {
      const source = buildSource(report, originalIndex);
      const match = merged.find((candidate) => areSimilarComments(candidate, comment));
      if (!match) {
        merged.push({
          file: comment.file,
          line: comment.line,
          severity: comment.severity,
          comment: comment.comment,
          sources: [source],
        });
        return;
      }
      match.sources.push(source);
      if (isBetterCommentCandidate(comment, match)) {
        match.file = comment.file;
        match.line = comment.line;
        match.severity = comment.severity;
        match.comment = comment.comment;
      }
    });
  }
  return merged.sort(compareMergedComments);
}

function mergeSuggestions(reports: EvalReviewerReport[]): EvalMergedSuggestion[] {
  const merged: EvalMergedSuggestion[] = [];
  for (const report of reports) {
    report.report.suggestions.forEach((suggestion, originalIndex) => {
      const match = merged.find((candidate) => areSimilarSuggestionTexts(candidate.text, suggestion));
      const source = buildSource(report, originalIndex);
      if (!match) {
        merged.push({ text: suggestion, sources: [source] });
        return;
      }
      match.sources.push(source);
      if (isBetterSuggestionCandidate(suggestion, match.text)) {
        match.text = suggestion;
      }
    });
  }
  return merged;
}

function buildMergedSummary(reports: EvalReviewerReport[]): string {
  const unique = new Set<string>();
  const summaries: string[] = [];
  for (const report of reports) {
    const summary = report.report.summary.trim();
    if (!summary || unique.has(summary)) continue;
    unique.add(summary);
    summaries.push(`${report.reviewerName}: ${summary}`);
  }
  return summaries.join(" ");
}

function buildSource(report: EvalReviewerReport, originalIndex: number): EvalMergedFindingSource {
  return {
    reviewerSlug: report.reviewerSlug,
    reviewerName: report.reviewerName,
    originalIndex,
  };
}

function areSimilarComments(existing: EvalMergedComment, incoming: FileComment): boolean {
  if (existing.file !== incoming.file) return false;
  if (!linesAreCompatible(existing.line, incoming.line)) return false;
  if (!severitiesAreCompatible(existing.severity, incoming.severity)) return false;
  const threshold = existing.line !== undefined && incoming.line !== undefined
    ? (existing.line === incoming.line ? 0.18 : 0.25)
    : 0.55;
  return textSimilarity(existing.comment, incoming.comment) >= threshold;
}

function areSimilarSuggestionTexts(a: string, b: string): boolean {
  return textSimilarity(a, b) >= 0.65;
}

function linesAreCompatible(a?: number, b?: number): boolean {
  if (a === undefined || b === undefined) return true;
  return Math.abs(a - b) <= 3;
}

function severitiesAreCompatible(a: FileComment["severity"], b: FileComment["severity"]): boolean {
  return Math.abs(SEVERITY_ORDER[a] - SEVERITY_ORDER[b]) <= 1;
}

function isBetterCommentCandidate(candidate: FileComment, existing: EvalMergedComment): boolean {
  const candidateScore = scoreCommentCandidate(candidate.comment, candidate.line);
  const existingScore = scoreCommentCandidate(existing.comment, existing.line);
  return candidateScore > existingScore;
}

function isBetterSuggestionCandidate(candidate: string, existing: string): boolean {
  return scoreTextSpecificity(candidate) > scoreTextSpecificity(existing);
}

function scoreCommentCandidate(text: string, line?: number): number {
  return scoreTextSpecificity(text) + (line !== undefined ? 10 : 0);
}

function scoreTextSpecificity(text: string): number {
  const normalized = normalizeText(text);
  return normalized.length;
}

function compareMergedComments(a: EvalMergedComment, b: EvalMergedComment): number {
  if (a.file !== b.file) return a.file.localeCompare(b.file);
  return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
}

function textSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return normalizeText(a) === normalizeText(b) ? 1 : 0;
  }
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .map((token) => normalizeToken(token.trim()))
      .filter(Boolean),
  );
}

function normalizeText(text: string): string {
  let normalized = text.toLowerCase();
  for (const pattern of FILLER_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }
  return normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(token: string): string {
  if (token === "logging" || token === "logged" || token === "logs") return "log";
  if (token === "leaks" || token === "leaked" || token === "leaking") return "leak";
  if (token === "exposes" || token === "exposed" || token === "exposing") return "expose";
  if (token === "credentials") return "credential";
  if (token === "secrets") return "secret";
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}
