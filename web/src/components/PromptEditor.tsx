import { useState, useEffect } from "react";
import { useApi, apiPut } from "../hooks/useApi";

const TEMPLATE_VARS = [
  { name: "{{task_summary}}", desc: "Task description from the calling agent" },
  { name: "{{rules}}", desc: "Formatted review rules with severity" },
  { name: "{{diff}}", desc: "Git diff content" },
  { name: "{{changed_files}}", desc: "List of changed files with stats" },
  { name: "{{stats}}", desc: "Overall diff statistics" },
  { name: "{{is_chunk}}", desc: "Whether this is a partial chunk review" },
  { name: "{{chunk_info}}", desc: "Chunk label, e.g. 'Chunk 2 of 4'" },
];

export function PromptEditor() {
  const { data, loading } = useApi<{ content: string }>("/api/prompt");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setContent(data.content); }, [data]);

  if (loading) return <p className="text-gray-500">Loading prompt...</p>;

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

function EditorPanel({ content, onChange, onSave, saved }: { content: string; onChange: (v: string) => void; onSave: () => void; saved: boolean }) {
  return (
    <div className="flex-1">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Prompt Editor</h2>
        <div className="flex items-center gap-3">
          <button onClick={onSave} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Save</button>
          {saved && <span className="text-green-600 text-sm">Saved!</span>}
        </div>
      </div>
      <textarea value={content} onChange={(e) => onChange(e.target.value)} className="w-full h-[600px] font-mono text-sm border rounded p-4 bg-white" />
    </div>
  );
}

function VariableReference() {
  return (
    <div className="w-72 shrink-0">
      <h3 className="text-sm font-bold text-gray-700 mb-3">Template Variables</h3>
      <div className="bg-white border rounded p-4 space-y-3">
        {TEMPLATE_VARS.map((v) => (
          <div key={v.name}>
            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-bold">{v.name}</code>
            <p className="text-xs text-gray-500 mt-0.5">{v.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
