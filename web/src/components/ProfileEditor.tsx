import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApi, apiPut, apiPost } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { TooltipProvider, Tooltip } from "./ui/Tooltip";
import { RuleLinker } from "./RuleLinker";

interface ProfileDetail {
  id: number;
  slug: string;
  name: string;
  description: string;
  prompt: string;
  file_patterns: string;
  enabled: number;
  source_hash: string | null;
  rules: Array<{ id: number; name: string }>;
  updates: Array<{
    id: number;
    new_hash: string;
    new_content: string;
    dismissed: number;
    detected_at: string;
  }>;
}

const TEMPLATE_VARS = [
  { name: "{{task_summary}}", desc: "Task description from the calling agent" },
  { name: "{{rules}}", desc: "Formatted review rules with severity" },
  { name: "{{diff}}", desc: "Git diff content" },
  { name: "{{changed_files}}", desc: "List of changed files with stats" },
  { name: "{{stats}}", desc: "Overall diff statistics" },
  { name: "{{is_chunk}}", desc: "Whether this is a partial chunk review" },
  { name: "{{chunk_info}}", desc: "Chunk label, e.g. 'Chunk 2 of 4'" },
  { name: "{{previous_reviews}}", desc: "Formatted history of previous reviews in this session" },
  { name: "{{user_comments}}", desc: "Active authoritative user comment threads for the current snapshot" },
  { name: "{{orphaned_user_comments}}", desc: "Orphaned unresolved user comment threads for the current snapshot" },
];

export function ProfileEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, refetch } = useApi<ProfileDetail>(`/api/profiles/${id}`);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [linkedRuleIds, setLinkedRuleIds] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setDescription(data.description);
      setPrompt(data.prompt);
      setPatterns(JSON.parse(data.file_patterns));
      setLinkedRuleIds(new Set(data.rules.map((r) => r.id)));
    }
  }, [data]);

  if (loading) return <LoadingState />;
  if (!data) return <NotFound />;

  async function handleSave() {
    await apiPut(`/api/profiles/${id}`, {
      name,
      description,
      prompt,
      filePatterns: patterns,
    });
    // Save rule links
    await apiPut(`/api/profiles/${id}/rules`, {
      ruleIds: Array.from(linkedRuleIds),
    });
    setSaved(true);
    refetch();
    setTimeout(() => setSaved(false), 2000);
  }

  function addPattern() {
    const trimmed = newPattern.trim();
    if (trimmed && !patterns.includes(trimmed)) {
      setPatterns([...patterns, trimmed]);
      setNewPattern("");
    }
  }

  function removePattern(index: number) {
    setPatterns(patterns.filter((_, i) => i !== index));
  }

  function handleToggleRule(ruleId: number, linked: boolean) {
    const next = new Set(linkedRuleIds);
    if (linked) {
      next.add(ruleId);
    } else {
      next.delete(ruleId);
    }
    setLinkedRuleIds(next);
  }

  async function handleAdopt(updateId: number) {
    await apiPost(`/api/profiles/${id}/updates/${updateId}/adopt`, {});
    refetch();
  }

  async function handleDismiss(updateId: number) {
    await apiPost(`/api/profiles/${id}/updates/${updateId}/dismiss`, {});
    refetch();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/reviewers")}
            className="mb-2 flex items-center gap-1 text-sm text-stone-400 hover:text-stone-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Reviewers
          </button>
          <h2 className="text-xl font-semibold text-stone-900">Edit Profile</h2>
          <p className="mt-0.5 text-sm text-stone-400">
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">{data.slug}</code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SavedIndicator visible={saved} />
          <Button onClick={handleSave}>Save Profile</Button>
        </div>
      </div>

      {/* Update notifications */}
      {data.updates.length > 0 && (
        <UpdateNotifications updates={data.updates} onAdopt={handleAdopt} onDismiss={handleDismiss} />
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Left column: Metadata + Patterns + Rules */}
        <div className="col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-stone-700">Metadata</h3>
            </CardHeader>
            <CardBody className="space-y-4">
              <FormField label="Name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Node.js Backend Reviewer"
                />
              </FormField>
              <FormField label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Short description of the reviewer's focus area"
                  className="resize-none"
                />
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-stone-700">File Patterns</h3>
              <p className="mt-0.5 text-xs text-stone-400">
                Glob patterns to auto-match this reviewer to changed files.
              </p>
            </CardHeader>
            <CardBody>
              <div className="flex flex-wrap gap-2 mb-3">
                {patterns.map((p, i) => (
                  <PatternChip key={i} pattern={p} onRemove={() => removePattern(i)} />
                ))}
                {patterns.length === 0 && (
                  <p className="text-xs text-stone-400">No patterns — add one below.</p>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPattern())}
                  placeholder='e.g. src/api/**'
                  className="flex-1 text-sm"
                />
                <Button variant="secondary" size="sm" onClick={addPattern}>
                  Add
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <RuleLinker linkedRuleIds={linkedRuleIds} onToggleRule={handleToggleRule} />
            </CardBody>
          </Card>
        </div>

        {/* Right column: Prompt editor + variable reference */}
        <div className="col-span-2 space-y-6">
          <VariableReference />
          <Card>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="h-[520px] w-full rounded-lg border-0 bg-white p-5 font-mono text-sm leading-relaxed text-stone-800 focus:ring-0"
              spellCheck={false}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function PatternChip({ pattern, onRemove }: { pattern: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2.5 py-1 text-xs font-mono text-stone-700">
      {pattern}
      <button
        onClick={onRemove}
        className="text-stone-400 hover:text-stone-600"
        type="button"
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

function UpdateNotifications({
  updates,
  onAdopt,
  onDismiss,
}: {
  updates: ProfileDetail["updates"];
  onAdopt: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="mb-6 space-y-3">
      {updates.map((u) => (
        <div
          key={u.id}
          className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4"
        >
          <div className="flex items-center gap-3">
            <Badge variant="warning">Update Available</Badge>
            <span className="text-sm text-stone-600">
              The on-disk profile file has been modified since this profile was last synced.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => onAdopt(u.id)}>
              Adopt
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDismiss(u.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function VariableReference() {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-stone-700">Template Variables</h3>
        <p className="mt-0.5 text-xs text-stone-400">
          Use these placeholders in the prompt template above.
        </p>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-2">
          <TooltipProvider>
            {TEMPLATE_VARS.map((v) => (
              <Tooltip key={v.name} content={v.desc} side="top">
                <div className="cursor-default">
                  <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-stone-700">
                    {v.name}
                  </code>
                </div>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
      </CardBody>
    </Card>
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

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading profile...
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-medium text-stone-500">Profile not found</p>
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
