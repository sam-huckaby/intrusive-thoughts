import { useParams, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { VerdictBadge, SeverityBadge } from "./ui/Badge";

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

  if (loading) return <LoadingState />;
  if (!review) return <NotFoundState />;

  const result: ReviewResult = JSON.parse(review.result_json);

  return (
    <div>
      <BackButton onClick={() => navigate("/reviews")} />
      <ReviewHeader review={review} result={result} />
      <div className="mt-6 space-y-6">
        <SummarySection text={result.summary} />
        <CommentsSection comments={result.comments} />
        <SuggestionsSection items={result.suggestions} />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading review...
    </div>
  );
}

function NotFoundState() {
  return (
    <Card className="py-16 text-center">
      <p className="text-sm font-medium text-stone-500">Review not found</p>
    </Card>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="mb-4 -ml-2 gap-1.5">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back to reviews
    </Button>
  );
}

function ReviewHeader({ review, result }: { review: Review; result: ReviewResult }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-stone-900">{review.task_summary}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <VerdictBadge verdict={result.verdict} />
        <MetaItem label="Confidence" value={`${Math.round(result.confidence * 100)}%`} />
        <MetaSeparator />
        <MetaItem label="Provider" value={`${review.provider}/${review.model}`} />
        <MetaSeparator />
        <MetaItem label="Date" value={formatDate(review.created_at)} />
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-stone-500">
      <span className="text-stone-400">{label}:</span> {value}
    </span>
  );
}

function MetaSeparator() {
  return <span className="text-stone-200">|</span>;
}

function SummarySection({ text }: { text: string }) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-stone-700">Summary</h3>
      </CardHeader>
      <CardBody>
        <p className="text-sm leading-relaxed text-stone-600">{text}</p>
      </CardBody>
    </Card>
  );
}

function CommentsSection({ comments }: { comments: ReviewResult["comments"] }) {
  if (comments.length === 0) return null;
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-stone-700">
        Comments <span className="font-normal text-stone-400">({comments.length})</span>
      </h3>
      <div className="space-y-2">
        {comments.map((c, i) => (
          <CommentCard key={i} comment={c} />
        ))}
      </div>
    </div>
  );
}

function CommentCard({ comment }: { comment: ReviewResult["comments"][0] }) {
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={comment.severity} />
          <code className="text-xs text-stone-400">
            {comment.file}{comment.line ? `:${comment.line}` : ""}
          </code>
        </div>
        <p className="text-sm leading-relaxed text-stone-600">{comment.comment}</p>
      </CardBody>
    </Card>
  );
}

function SuggestionsSection({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-stone-700">Suggestions</h3>
      </CardHeader>
      <CardBody>
        <ul className="space-y-2">
          {items.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm text-stone-600">
              <span className="mt-0.5 shrink-0 text-stone-300">-</span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
