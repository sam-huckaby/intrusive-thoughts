import { useState, useEffect } from "react";
import { useApi, apiPut } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { Card, CardBody } from "./ui/Card";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
];

export function ConfigPage() {
  const { data, loading, refetch } = useApi<Record<string, string>>("/api/config");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  if (loading) return <LoadingState />;

  async function handleSave() {
    await apiPut("/api/config", form);
    setSaved(true);
    refetch();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <PageHeader />
      <Card className="max-w-lg">
        <CardBody className="space-y-5">
          <FormField label="Provider">
            <Select
              value={form.provider ?? ""}
              onValueChange={(v) => setForm({ ...form, provider: v })}
              options={PROVIDERS}
            />
          </FormField>
          <FormField label="Model">
            <input
              type="text"
              value={form.model ?? ""}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g. claude-sonnet-4-20250514"
            />
          </FormField>
          <FormField label="Base Branch">
            <input
              type="text"
              value={form.baseBranch ?? ""}
              onChange={(e) => setForm({ ...form, baseBranch: e.target.value })}
              placeholder="e.g. main"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Max Diff Lines">
              <input
                type="number"
                value={form.maxDiffLines ?? ""}
                onChange={(e) => setForm({ ...form, maxDiffLines: e.target.value })}
              />
            </FormField>
            <FormField label="Max Files Per Chunk">
              <input
                type="number"
                value={form.chunkSize ?? ""}
                onChange={(e) => setForm({ ...form, chunkSize: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="HTTP Port">
            <input
              type="number"
              value={form.httpPort ?? ""}
              onChange={(e) => setForm({ ...form, httpPort: e.target.value })}
            />
          </FormField>
          <FormField label="Max Review Rounds (MCP)">
            <input
              type="number"
              min="1"
              max="20"
              value={form.maxReviewRounds ?? ""}
              onChange={(e) => setForm({ ...form, maxReviewRounds: e.target.value })}
            />
            <p className="mt-1 text-xs text-stone-400">
              Maximum number of times an agent can request a review in a single MCP session.
              Prevents runaway review loops. Default: 5.
            </p>
          </FormField>
          <EnvNote />
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleSave}>Save Configuration</Button>
            <SavedIndicator visible={saved} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading configuration...
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold text-stone-900">Configuration</h2>
      <p className="mt-1 text-sm text-stone-500">
        Manage the LLM provider, model, and review settings.
      </p>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-stone-700">{label}</label>
      {children}
    </div>
  );
}

function EnvNote() {
  return (
    <div className="rounded-md bg-stone-50 p-3 ring-1 ring-stone-200">
      <p className="text-xs leading-relaxed text-stone-500">
        API keys are read from environment variables at runtime:
        <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 font-mono text-stone-600">ANTHROPIC_API_KEY</code>
        or
        <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 font-mono text-stone-600">OPENAI_API_KEY</code>.
        They are never stored in the database.
      </p>
    </div>
  );
}

function SavedIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm text-emerald-600">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Saved
    </span>
  );
}
