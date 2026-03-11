import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";

interface ReviewSummary {
  id: number;
  task_summary: string;
  verdict: string;
  files_reviewed: string;
  provider: string;
  model: string;
  created_at: string;
}

export function ReviewHistory() {
  const { data: reviews, loading } = useApi<ReviewSummary[]>("/api/reviews");
  const navigate = useNavigate();

  if (loading) return <p className="text-gray-500">Loading reviews...</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Review History</h2>
      {(!reviews || reviews.length === 0) ? (
        <p className="text-gray-500">No reviews yet. Run a review via CLI, MCP, or the API.</p>
      ) : (
        <ReviewTable reviews={reviews} onSelect={(id) => navigate(`/reviews/${id}`)} />
      )}
    </div>
  );
}

function ReviewTable({ reviews, onSelect }: { reviews: ReviewSummary[]; onSelect: (id: number) => void }) {
  return (
    <table className="w-full bg-white rounded border text-sm">
      <thead><tr className="border-b bg-gray-50"><th className="p-3 text-left">Date</th><th className="p-3 text-left">Verdict</th><th className="p-3 text-left">Files</th><th className="p-3 text-left">Summary</th></tr></thead>
      <tbody>
        {reviews.map((r) => (
          <tr key={r.id} onClick={() => onSelect(r.id)} className="border-b hover:bg-gray-50 cursor-pointer">
            <td className="p-3 text-gray-500">{new Date(r.created_at).toLocaleDateString()}</td>
            <td className="p-3"><VerdictBadge verdict={r.verdict} /></td>
            <td className="p-3">{countFiles(r.files_reviewed)}</td>
            <td className="p-3 truncate max-w-xs">{r.task_summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const isApproved = verdict === "approve";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${isApproved ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
      {isApproved ? "Approved" : "Changes Requested"}
    </span>
  );
}

function countFiles(filesJson: string): number {
  try { return JSON.parse(filesJson).length; }
  catch { return 0; }
}
