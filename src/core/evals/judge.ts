import { ParseError } from "../../types";
import type {
  EvalExpectedFinding,
  EvalJudgeResult,
  EvalMergedReport,
} from "../../types";
import type { LLMProvider } from "../reviewer/providers/types";

export async function judgeEvalRun(
  provider: LLMProvider,
  mergedReport: EvalMergedReport,
  findings: EvalExpectedFinding[],
): Promise<EvalJudgeResult> {
  const raw = await provider.call(
    buildJudgeSystemPrompt(),
    buildJudgeUserMessage(mergedReport, findings),
  );
  return parseJudgeResult(raw);
}

export function parseJudgeResult(raw: string): EvalJudgeResult {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ParseError("Invalid JSON in eval judge response", json);
  }
  return validateJudgeResult(parsed);
}

function buildJudgeSystemPrompt(): string {
  return [
    "You are grading the accuracy of a combined code review report against expected findings.",
    "Match issues semantically, not by exact wording.",
    "Required findings matter more than optional findings.",
    "Do not give credit for invented issues that are not supported by the expected findings.",
    "Return JSON only.",
  ].join(" ");
}

function buildJudgeUserMessage(
  mergedReport: EvalMergedReport,
  findings: EvalExpectedFinding[],
): string {
  return [
    "Score the merged code review report against the expected findings.",
    "",
    "Expected findings:",
    JSON.stringify(findings, null, 2),
    "",
    "Merged report:",
    JSON.stringify(mergedReport, null, 2),
    "",
    "Return JSON with this schema:",
    JSON.stringify({
      score: 0.82,
      summary: "Short explanation of the result.",
      findings: [
        {
          findingId: 1,
          status: "matched",
          rationale: "Why the finding matched.",
          matchedCommentIndexes: [0],
        },
        {
          findingId: 2,
          status: "partial",
          rationale: "Why the finding partially matched.",
          matchedCommentIndexes: [0],
        },
        {
          findingId: 3,
          status: "missed",
          rationale: "Why the finding was missed.",
          matchedCommentIndexes: [0],
        },
      ],
      extras: [
        {
          commentIndex: 1,
          rationale: "Why this appears to be an extra or likely false positive.",
        },
      ],
    }, null, 2),
  ].join("\n");
}

function extractJson(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();
}

function validateJudgeResult(parsed: unknown): EvalJudgeResult {
  if (!isObject(parsed)) throw new ParseError("Eval judge response is not an object");
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.map(validateJudgeFinding)
    : [];
  const extras = Array.isArray(parsed.extras)
    ? parsed.extras.map(validateJudgeExtra)
    : [];
  return {
    score: clampScore(parsed.score),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    findings,
    extras,
  };
}

function validateJudgeFinding(value: unknown): EvalJudgeResult["findings"][number] {
  if (!isObject(value)) throw new ParseError("Eval judge finding entry is not an object");
  const status = normalizeStatus(value.status);
  return {
    findingId: typeof value.findingId === "number" ? value.findingId : 0,
    status,
    rationale: typeof value.rationale === "string" ? value.rationale : "",
    matchedCommentIndexes: Array.isArray(value.matchedCommentIndexes)
      ? value.matchedCommentIndexes.filter((item): item is number => typeof item === "number")
      : [],
  };
}

function normalizeStatus(value: unknown): "matched" | "partial" | "missed" {
  if (typeof value !== "string") return "missed";
  const lower = value.toLowerCase().trim();
  if (lower === "matched" || lower === "found" || lower === "detected") return "matched";
  if (lower === "partial" || lower === "partially_matched") return "partial";
  return "missed";
}

function validateJudgeExtra(value: unknown): EvalJudgeResult["extras"][number] {
  if (!isObject(value)) throw new ParseError("Eval judge extra entry is not an object");
  return {
    commentIndex: typeof value.commentIndex === "number" ? value.commentIndex : 0,
    rationale: typeof value.rationale === "string" ? value.rationale : "",
  };
}

function clampScore(value: unknown): number {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(1, value));
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
