import { useState, useEffect } from "react";
import { useApi, apiPut } from "../hooks/useApi";

export function ConfigPage() {
  const { data, loading, refetch } = useApi<Record<string, string>>("/api/config");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  if (loading) return <p className="text-gray-500">Loading config...</p>;

  async function handleSave() {
    await apiPut("/api/config", form);
    setSaved(true);
    refetch();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Configuration</h2>
      <div className="bg-white rounded border p-6 space-y-4 max-w-lg">
        <SelectField label="Provider" value={form.provider ?? ""} options={["anthropic", "openai"]} onChange={(v) => setForm({ ...form, provider: v })} />
        <TextField label="Model" value={form.model ?? ""} onChange={(v) => setForm({ ...form, model: v })} />
        <TextField label="Base Branch" value={form.baseBranch ?? ""} onChange={(v) => setForm({ ...form, baseBranch: v })} />
        <NumberField label="Max Diff Lines" value={form.maxDiffLines ?? ""} onChange={(v) => setForm({ ...form, maxDiffLines: v })} />
        <NumberField label="Chunk Size" value={form.chunkSize ?? ""} onChange={(v) => setForm({ ...form, chunkSize: v })} />
        <NumberField label="HTTP Port" value={form.httpPort ?? ""} onChange={(v) => setForm({ ...form, httpPort: v })} />
        <EnvNote />
        <div className="flex items-center gap-3">
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Save</button>
          {saved && <span className="text-green-600 text-sm">Saved!</span>}
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded border-gray-300 border px-3 py-2 text-sm" />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded border-gray-300 border px-3 py-2 text-sm" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded border-gray-300 border px-3 py-2 text-sm">
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  );
}

function EnvNote() {
  return (
    <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded">
      API keys are read from environment variables at runtime: <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code>. They are never stored in the database.
    </p>
  );
}
