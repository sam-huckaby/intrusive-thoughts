import { useState } from "react";

interface RuleFormData {
  name: string;
  description: string;
  category: string;
  severity: string;
}

interface RuleFormProps {
  initial?: RuleFormData;
  onSubmit: (data: RuleFormData) => void;
  onCancel: () => void;
}

const CATEGORIES = ["general", "style", "security", "performance", "architecture", "maintainability"];
const SEVERITIES = ["critical", "warning", "suggestion"];

export function RuleForm({ initial, onSubmit, onCancel }: RuleFormProps) {
  const [form, setForm] = useState<RuleFormData>(
    initial ?? { name: "", description: "", category: "general", severity: "warning" },
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white p-4 rounded border">
      <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <TextArea label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
      <Select label="Category" value={form.category} options={CATEGORIES} onChange={(v) => setForm({ ...form, category: v })} />
      <Select label="Severity" value={form.severity} options={SEVERITIES} onChange={(v) => setForm({ ...form, severity: v })} />
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Save</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300">Cancel</button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded border-gray-300 border px-3 py-2 text-sm" required />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="mt-1 block w-full rounded border-gray-300 border px-3 py-2 text-sm" required />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded border-gray-300 border px-3 py-2 text-sm">
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  );
}
