import { useState, useEffect } from "react";
import { useApi, apiPut } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { TooltipProvider, Tooltip } from "./ui/Tooltip";

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

export function PromptEditor() {
  const { data, loading } = useApi<{ content: string }>("/api/prompt");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setContent(data.content); }, [data]);

  if (loading) return <LoadingState />;

  async function handleSave() {
    await apiPut("/api/prompt", { content });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex gap-6">
      <EditorPanel content={content} onChange={setContent} onSave={handleSave} saved={saved} />
      <VariableReference />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading prompt...
    </div>
  );
}

interface EditorPanelProps {
  content: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saved: boolean;
}

function EditorPanel({ content, onChange, onSave, saved }: EditorPanelProps) {
  return (
    <div className="flex-1">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Prompt Editor</h2>
          <p className="mt-1 text-sm text-stone-500">
            Edit the system prompt template used for code reviews.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={onSave}>Save Prompt</Button>
          <SavedIndicator visible={saved} />
        </div>
      </div>
      <Card>
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          className="h-[600px] w-full rounded-lg border-0 bg-white p-5 font-mono text-sm leading-relaxed text-stone-800 focus:ring-0"
          spellCheck={false}
        />
      </Card>
    </div>
  );
}

function VariableReference() {
  return (
    <div className="w-72 shrink-0">
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold text-stone-700">Template Variables</h3>
          <p className="mt-0.5 text-xs text-stone-400">
            Use these placeholders in your prompt template.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          <TooltipProvider>
            {TEMPLATE_VARS.map((v) => (
              <VariableItem key={v.name} name={v.name} desc={v.desc} />
            ))}
          </TooltipProvider>
        </CardBody>
      </Card>
    </div>
  );
}

function VariableItem({ name, desc }: { name: string; desc: string }) {
  return (
    <Tooltip content={desc} side="left">
      <div className="cursor-default">
        <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-stone-700">
          {name}
        </code>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-400">{desc}</p>
      </div>
    </Tooltip>
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
