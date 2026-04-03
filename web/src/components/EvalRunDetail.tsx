import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { SeverityBadge, VerdictBadge, Badge } from "./ui/Badge";

interface EvalFinding {
  id: number;
  title: string;
  severity: "critical" | "warning" | "suggestion";
  required: boolean;
}

interface EvalFixture {
  id: number;
  name: string;
  findings: EvalFinding[];
}

interface EvalRun {
  id: number;
  fixtureIds: number[];
  reviewerSlugs: string[];
  reviewerReports: Array<{
    reviewerSlug: string;
    reviewerName: string;
    report: {
      verdict: string;
      summary: string;
      comments: Array<{ file: string; line?: number; severity: string; comment: string }>;
      suggestions: string[];
      confidence: number;
    };
  }>;
  mergedReport: {
    verdict: string;
    summary: string;
    comments: Array<{
      file: string;
      line?: number;
      severity: string;
      comment: string;
      sources: Array<{ reviewerSlug: string; reviewerName: string }>;
    }>;
    suggestions: Array<{ text: string; sources: Array<{ reviewerSlug: string; reviewerName: string }> }>;
    confidence: number;
  };
  judgeResult: {
    score: number;
    summary: string;
    findings: Array<{ findingId: number; status: string; rationale: string }>;
    extras: Array<{ commentIndex: number; rationale: string }>;
  };
  judgeProvider: string;
  judgeModel: string;
  createdAt: string;
}

export function EvalRunDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { data: run, loading } = useApi<EvalRun>(`/api/evals/runs/${id}`);
  const { data: fixtures } = useApi<EvalFixture[]>("/api/evals/fixtures");

  const findingLookup = useMemo(() => {
    const map = new Map<number, EvalFinding>();
    if (!fixtures || !run) return map;
    for (const fixture of fixtures) {
      if (run.fixtureIds.includes(fixture.id)) {
        for (const finding of fixture.findings) {
          map.set(finding.id, finding);
        }
      }
    }
    return map;
  }, [fixtures, run]);

  if (loading) return <LoadingState />;
  if (!run) return <NotFoundState />;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/evals")} className="-ml-2">Back to evals</Button>
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Eval Run #{run.id}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-500">
          <span>{new Date(run.createdAt).toLocaleString()}</span>
          <span>|</span>
          <span>{run.reviewerSlugs.join(", ")}</span>
          <span>|</span>
          <span>{run.judgeProvider}/{run.judgeModel}</span>
        </div>
      </div>

      <Card>
        <CardHeader><h3 className="text-sm font-semibold text-stone-700">Judge Result</h3></CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge>{Math.round(run.judgeResult.score * 100)}%</Badge>
            <VerdictBadge verdict={run.mergedReport.verdict} />
          </div>
          <p className="text-sm text-stone-600">{run.judgeResult.summary}</p>

          <div>
            <h4 className="mb-2 text-sm font-medium text-stone-700">Expected Findings</h4>
            <div className="space-y-2">
              {run.judgeResult.findings.map((finding) => {
                const meta = findingLookup.get(finding.findingId);
                return (
                  <div
                    key={finding.findingId}
                    className={`rounded-md border p-3 ${
                      finding.status === "matched"
                        ? "border-emerald-200 bg-emerald-50/50"
                        : finding.status === "partial"
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-red-200 bg-red-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold uppercase ${
                        finding.status === "matched"
                          ? "text-emerald-700"
                          : finding.status === "partial"
                          ? "text-amber-700"
                          : "text-red-700"
                      }`}>
                        {finding.status === "matched" ? "Caught" : finding.status === "partial" ? "Partial" : "Missed"}
                      </span>
                      <span className="text-sm italic text-stone-700">
                        {meta?.title ?? `Finding #${finding.findingId}`}
                      </span>
                      {meta && <SeverityBadge severity={meta.severity} />}
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{finding.rationale}</p>
                  </div>
                );
              })}
              {run.judgeResult.findings.length === 0 && (
                <p className="text-sm text-stone-400">No expected findings.</p>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium text-stone-700">Extras</h4>
            <div className="space-y-2">
              {run.judgeResult.extras.map((extra, index) => {
                const comment = run.mergedReport.comments[extra.commentIndex];
                return (
                  <div key={index} className="rounded-md border border-stone-200 bg-stone-50/50 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase text-stone-400">Extra</span>
                      {comment && <SeverityBadge severity={comment.severity} />}
                      {comment && (
                        <code className="text-xs text-stone-400">
                          {comment.file}{comment.line ? `:${comment.line}` : ""}
                        </code>
                      )}
                    </div>
                    {comment && <p className="mt-1 text-sm italic text-stone-500">{comment.comment}</p>}
                    <p className="mt-1 text-xs text-stone-400">{extra.rationale}</p>
                  </div>
                );
              })}
              {run.judgeResult.extras.length === 0 && (
                <p className="text-sm text-stone-400">No extras scored.</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h3 className="text-sm font-semibold text-stone-700">Merged Report</h3></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-stone-600">{run.mergedReport.summary}</p>
          <div className="space-y-3">
            {run.mergedReport.comments.map((comment, index) => (
              <div key={index} className="rounded-md border border-stone-200 p-4">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={comment.severity} />
                  <code className="text-xs text-stone-400">{comment.file}{comment.line ? `:${comment.line}` : ""}</code>
                </div>
                <p className="mt-2 text-sm text-stone-600">{comment.comment}</p>
                <p className="mt-2 text-xs text-stone-400">Sources: {comment.sources.map((source) => source.reviewerName).join(", ")}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-stone-700">Per-Reviewer Reports</h3>
        <div className="space-y-4">
          {run.reviewerReports.map((entry) => (
            <Card key={entry.reviewerSlug}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-stone-700">{entry.reviewerName}</h4>
                  <VerdictBadge verdict={entry.report.verdict} />
                </div>
              </CardHeader>
              <CardBody className="space-y-3">
                <p className="text-sm text-stone-600">{entry.report.summary}</p>
                {entry.report.comments.map((comment, index) => (
                  <div key={index} className="rounded-md border border-stone-200 p-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={comment.severity} />
                      <code className="text-xs text-stone-400">{comment.file}{comment.line ? `:${comment.line}` : ""}</code>
                    </div>
                    <p className="mt-2 text-sm text-stone-600">{comment.comment}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}


function LoadingState() {
  return <div className="text-sm text-stone-400">Loading eval run...</div>;
}

function NotFoundState() {
  return <div className="text-sm text-stone-400">Eval run not found.</div>;
}
