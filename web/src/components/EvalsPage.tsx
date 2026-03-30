import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, useApi } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";

interface EvalFinding {
  id: number;
  title: string;
  severity: "critical" | "warning" | "suggestion";
  required: boolean;
}

interface EvalFixture {
  id: number;
  name: string;
  fileName: string;
  language: string;
  notes: string;
  findings: EvalFinding[];
}

interface Profile {
  id: number;
  slug: string;
  name: string;
  enabled: number;
}

interface EvalRunSummary {
  id: number;
  fixtureIds: number[];
  reviewerSlugs: string[];
  judgeResult: { score: number; summary: string };
  createdAt: string;
}

export function EvalsPage() {
  const navigate = useNavigate();
  const { data: fixtures, loading: fixturesLoading } = useApi<EvalFixture[]>("/api/evals/fixtures");
  const { data: profiles, loading: profilesLoading } = useApi<Profile[]>("/api/profiles");
  const { data: runs, loading: runsLoading, refetch: refetchRuns } = useApi<EvalRunSummary[]>("/api/evals/runs");
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<number[]>([]);
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledProfiles = useMemo(
    () => (profiles ?? []).filter((profile) => profile.enabled === 1),
    [profiles],
  );

  if (fixturesLoading || profilesLoading || runsLoading) {
    return <LoadingState />;
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const run = await apiPost<{ id: number }>("/api/evals/run", {
        fixtureIds: selectedFixtureIds,
        reviewers: selectedReviewers,
      });
      refetchRuns();
      navigate(`/evals/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Evals</h2>
          <p className="mt-1 text-sm text-stone-500">
            Build a snippet library and run reviewer profiles against repeatable eval fixtures.
          </p>
        </div>
        <Button onClick={() => navigate("/evals/new")}>New Fixture</Button>
      </div>

      <RunLauncher
        fixtures={fixtures ?? []}
        reviewers={enabledProfiles}
        selectedFixtureIds={selectedFixtureIds}
        selectedReviewers={selectedReviewers}
        onFixtureToggle={(id) => setSelectedFixtureIds(toggleValue(selectedFixtureIds, id))}
        onReviewerToggle={(slug) => setSelectedReviewers(toggleValue(selectedReviewers, slug))}
        onRun={handleRun}
        running={running}
        error={error}
      />

      <FixturesSection fixtures={fixtures ?? []} onOpen={(id) => navigate(`/evals/${id}`)} />
      <RunsSection runs={runs ?? []} onOpen={(id) => navigate(`/evals/runs/${id}`)} />
    </div>
  );
}

function RunLauncher(props: {
  fixtures: EvalFixture[];
  reviewers: Profile[];
  selectedFixtureIds: number[];
  selectedReviewers: string[];
  onFixtureToggle: (id: number) => void;
  onReviewerToggle: (slug: string) => void;
  onRun: () => void;
  running: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-stone-700">Run Eval</h3>
            <p className="mt-1 text-xs text-stone-400">Select one or more fixtures and reviewers, then score the merged result.</p>
          </div>
          <Button
            onClick={props.onRun}
            disabled={props.running || props.selectedFixtureIds.length === 0 || props.selectedReviewers.length === 0}
          >
            {props.running ? "Running..." : "Run Eval"}
          </Button>
        </div>
      </CardHeader>
      <CardBody className="grid gap-6 md:grid-cols-2">
        <SelectionColumn
          title="Fixtures"
          empty="No fixtures yet"
          items={props.fixtures.map((fixture) => ({
            key: fixture.id,
            label: fixture.name,
            sublabel: fixture.fileName,
            checked: props.selectedFixtureIds.includes(fixture.id),
            onToggle: () => props.onFixtureToggle(fixture.id),
          }))}
        />
        <SelectionColumn
          title="Reviewers"
          empty="No enabled reviewers"
          items={props.reviewers.map((reviewer) => ({
            key: reviewer.slug,
            label: reviewer.name,
            sublabel: reviewer.slug,
            checked: props.selectedReviewers.includes(reviewer.slug),
            onToggle: () => props.onReviewerToggle(reviewer.slug),
          }))}
        />
        {props.error && (
          <p className="md:col-span-2 text-sm text-red-600">{props.error}</p>
        )}
      </CardBody>
    </Card>
  );
}

function SelectionColumn({ title, empty, items }: {
  title: string;
  empty: string;
  items: Array<{ key: string | number; label: string; sublabel: string; checked: boolean; onToggle: () => void }>;
}) {
  return (
    <div>
      <h4 className="mb-3 text-sm font-medium text-stone-700">{title}</h4>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-stone-400">{empty}</p>}
        {items.map((item) => (
          <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-stone-200 px-3 py-2 hover:bg-stone-50">
            <input type="checkbox" checked={item.checked} onChange={item.onToggle} className="mt-1" />
            <div>
              <div className="text-sm font-medium text-stone-700">{item.label}</div>
              <div className="text-xs text-stone-400">{item.sublabel}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function FixturesSection({ fixtures, onOpen }: { fixtures: EvalFixture[]; onOpen: (id: number) => void }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-stone-700">Fixture Library</h3>
      <div className="space-y-3">
        {fixtures.length === 0 && (
          <Card><CardBody><p className="text-sm text-stone-400">No eval fixtures yet.</p></CardBody></Card>
        )}
        {fixtures.map((fixture) => (
          <Card key={fixture.id} className="cursor-pointer transition-colors hover:bg-stone-50/80" >
            <button type="button" onClick={() => onOpen(fixture.id)} className="w-full text-left">
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-stone-800">{fixture.name}</h4>
                    <p className="mt-1 text-xs text-stone-400">{fixture.fileName}{fixture.language ? ` • ${fixture.language}` : ""}</p>
                  </div>
                  <span className="text-xs text-stone-400">{fixture.findings.length} findings</span>
                </div>
                {fixture.notes && <p className="text-sm text-stone-500">{fixture.notes}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {fixture.findings.slice(0, 4).map((finding) => (
                    <Badge key={finding.id} variant={finding.severity}>{finding.title}</Badge>
                  ))}
                  {fixture.findings.length > 4 && <Badge>+{fixture.findings.length - 4} more</Badge>}
                </div>
              </CardBody>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RunsSection({ runs, onOpen }: { runs: EvalRunSummary[]; onOpen: (id: number) => void }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-stone-700">Recent Runs</h3>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-xs font-medium uppercase tracking-wider text-stone-400">
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Fixtures</th>
              <th className="px-5 py-3">Reviewers</th>
              <th className="px-5 py-3">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {runs.map((run) => (
              <tr key={run.id} className="cursor-pointer hover:bg-stone-50/80" onClick={() => onOpen(run.id)}>
                <td className="px-5 py-3.5 text-stone-500">{formatDate(run.createdAt)}</td>
                <td className="px-5 py-3.5 text-stone-600">{run.fixtureIds.length}</td>
                <td className="px-5 py-3.5 text-stone-600">{run.reviewerSlugs.join(", ")}</td>
                <td className="px-5 py-3.5 font-medium text-stone-800">{Math.round((run.judgeResult?.score ?? 0) * 100)}%</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-stone-400">No eval runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading evals...
    </div>
  );
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
