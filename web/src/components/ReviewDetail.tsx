import { useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";

interface Review {
  id: number;
  task_summary: string;
  verdict: string;
  result_json: string;
  files_reviewed: string;
  provider: string;
  model: string;
  created_at: string;
}

interface ReviewResult {
  verdict: string;
  summary: string;
  comments: Array<{ file: string; line?: number; severity: string; comment: string }>;
  suggestions: string[];
  confidence: number;
}

export function ReviewDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: review, loading } = useApi<Review>(`/api/reviews/${id}`);

  if (loading) return <p className="text-gray-500">Loading review...</p>;
  if (!review) return <p className="text-red-500">Review not found.</p>;

  const result: ReviewResult = JSON.parse(review.result_json);

  return (
    <div>
      <button onClick={() => navigate("/reviews")} className="text-blue-600 hover:underline text-sm mb-4 block">&larr; Back to reviews</button>
      <Header review={review} result={result} />
      <Summary text={result.summary} />
      <Comments comments={result.comments} />
      <Suggestions items={result.suggestions} />
    </div>
  );
}

function Header({ review, result }: { review: Review; result: ReviewResult }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold mb-2">{review.task_summary}</h2>
      <div className="flex gap-4 text-sm text-gray-500">
        <span>{new Date(review.created_at).toLocaleString()}</span>
        <span>{review.provider}/{review.model}</span>
        <span>Confidence: {Math.round(result.confidence * 100)}%</span>
        <VerdictBadge verdict={result.verdict} />
      </div>
    </div>
  );
}

function Summary({ text }: { text: string }) {
  return (
    <div className="bg-white border rounded p-4 mb-6">
      <h3 className="text-sm font-bold text-gray-700 mb-2">Summary</h3>
      <p className="text-sm text-gray-600">{text}</p>
    </div>
  );
}

function Comments({ comments }: { comments: ReviewResult["comments"] }) {
  if (comments.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-gray-700 mb-3">Comments ({comments.length})</h3>
      <div className="space-y-2">
        {comments.map((c, i) => (
          <div key={i} className="bg-white border rounded p-3 text-sm">
            <div className="flex gap-2 items-center mb-1">
              <SeverityBadge severity={c.severity} />
              <code className="text-xs text-gray-500">{c.file}{c.line ? `:${c.line}` : ""}</code>
            </div>
            <p className="text-gray-600">{c.comment}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Suggestions({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-bold text-gray-700 mb-3">Suggestions</h3>
      <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 bg-white border rounded p-4">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
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

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = { critical: "bg-red-100 text-red-800", warning: "bg-yellow-100 text-yellow-800", suggestion: "bg-blue-100 text-blue-800", nitpick: "bg-gray-100 text-gray-600" };
  return <span className={`px-2 py-0.5 rounded text-xs ${colors[severity] ?? colors.nitpick}`}>{severity}</span>;
}
