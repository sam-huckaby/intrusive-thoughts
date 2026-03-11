import { useState } from "react";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";

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

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "style", label: "Style" },
  { value: "security", label: "Security" },
  { value: "performance", label: "Performance" },
  { value: "architecture", label: "Architecture" },
  { value: "maintainability", label: "Maintainability" },
];

const SEVERITIES = [
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "suggestion", label: "Suggestion" },
];

export function RuleForm({ initial, onSubmit, onCancel }: RuleFormProps) {
  const [form, setForm] = useState<RuleFormData>(
    initial ?? { name: "", description: "", category: "general", severity: "warning" },
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField label="Name">
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Rule name"
          required
        />
      </FormField>
      <FormField label="Description">
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          placeholder="What should this rule check for?"
          required
        />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Category">
          <Select
            value={form.category}
            onValueChange={(v) => setForm({ ...form, category: v })}
            options={CATEGORIES}
          />
        </FormField>
        <FormField label="Severity">
          <Select
            value={form.severity}
            onValueChange={(v) => setForm({ ...form, severity: v })}
            options={SEVERITIES}
          />
        </FormField>
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="submit">Save Rule</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
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
