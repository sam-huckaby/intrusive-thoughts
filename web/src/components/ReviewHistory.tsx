import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { Card } from "./ui/Card";
import { VerdictBadge } from "./ui/Badge";

interface ReviewSummary {
  id: number;
  task_summary: string;
  verdict: string;
  result_json: string;
  files_reviewed: string;
  provider: string;
  model: string;
  created_at: string;
}

export function ReviewHistory() {
  const { data: reviews, loading } = useApi<ReviewSummary[]>("/api/reviews");
  const navigate = useNavigate();

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader />
      {(!reviews || reviews.length === 0)
        ? <EmptyState />
        : <ReviewTable reviews={reviews} onSelect={(id) => navigate(`/reviews/${id}`)} />
      }
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading reviews...
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold text-stone-900">Review History</h2>
      <p className="mt-1 text-sm text-stone-500">
        Browse past code reviews run via CLI, MCP, or the API.
      </p>
    </div>
  );
}

function ReviewTable({ reviews, onSelect }: { reviews: ReviewSummary[]; onSelect: (id: number) => void }) {
  return (
    <Card>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-xs font-medium uppercase tracking-wider text-stone-400">
            <th className="px-5 py-3">Date</th>
            <th className="px-5 py-3">Reviewer</th>
            <th className="px-5 py-3">Verdict</th>
            <th className="px-5 py-3">Files</th>
            <th className="px-5 py-3">Summary</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {reviews.map((r) => (
            <ReviewRow key={r.id} review={r} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ReviewRow({ review, onSelect }: { review: ReviewSummary; onSelect: (id: number) => void }) {
  const profileName = parseProfileName(review.result_json);
  return (
    <tr
      onClick={() => onSelect(review.id)}
      className="cursor-pointer transition-colors hover:bg-stone-50/80"
    >
      <td className="px-5 py-3.5 text-stone-500">
        {formatDate(review.created_at)}
      </td>
      <td className="px-5 py-3.5">
        {profileName
          ? <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">{profileName}</span>
          : <span className="text-stone-300">&mdash;</span>
        }
      </td>
      <td className="px-5 py-3.5">
        <VerdictBadge verdict={review.verdict} />
      </td>
      <td className="px-5 py-3.5 text-stone-600">
        {countFiles(review.files_reviewed)}
      </td>
      <td className="max-w-xs truncate px-5 py-3.5 text-stone-600">
        {review.task_summary}
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium text-stone-500">No reviews yet</p>
      <p className="mt-1 text-xs text-stone-400">
        Run a review via CLI, MCP, or the API to see results here.
      </p>
    </Card>
  );
}

function parseProfileName(resultJson: string): string | null {
  try {
    const parsed = JSON.parse(resultJson);
    return parsed.profileName ?? null;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function countFiles(filesJson: string): number {
  try { return JSON.parse(filesJson).length; }
  catch { return 0; }
}
