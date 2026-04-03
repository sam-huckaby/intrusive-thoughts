import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiPost, apiPut } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { Select } from "./ui/Select";

type Severity = "critical" | "warning" | "suggestion";

interface FindingForm {
  id?: number;
  title: string;
  description: string;
  severity: Severity;
  lineHint: string;
  required: boolean;
  tags: string[];
}

interface FixtureResponse {
  id: number;
  name: string;
  fileName: string;
  language: string;
  category: string;
  code: string;
  notes: string;
  findings: FindingForm[];
}

const EMPTY_FINDING: FindingForm = {
  title: "",
  description: "",
  severity: "warning",
  lineHint: "",
  required: true,
  tags: [],
};

export function EvalFixtureEditor() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === "new";
  const [form, setForm] = useState<FixtureResponse>({
    id: 0,
    name: "",
    fileName: "",
    language: "",
    category: "",
    code: "",
    notes: "",
    findings: [{ ...EMPTY_FINDING }],
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/evals/fixtures/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FixtureResponse>;
      })
      .then((json) => {
        if (!cancelled) setForm(json);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  if (loading) {
    return <div className="text-sm text-stone-400">Loading fixture...</div>;
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      name: form.name,
      fileName: form.fileName,
      language: form.language,
      category: form.category,
      code: form.code,
      notes: form.notes,
      findings: form.findings,
    };
    try {
      if (isNew) {
        const created = await apiPost<FixtureResponse>("/api/evals/fixtures", payload);
        navigate(`/evals/${created.id}`);
      } else {
        await apiPut(`/api/evals/fixtures/${id}`, payload);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    await apiDelete(`/api/evals/fixtures/${id}`);
    navigate("/evals");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">{isNew ? "New Eval Fixture" : form.name || "Edit Eval Fixture"}</h2>
          <p className="mt-1 text-sm text-stone-500">Author a reusable snippet with structured expected findings.</p>
        </div>
        <div className="flex gap-2">
          {!isNew && <Button variant="ghost" onClick={handleDelete} className="text-red-600 hover:bg-red-50 hover:text-red-700">Delete</Button>}
          <Button variant="secondary" onClick={() => navigate("/evals")}>Back</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Fixture"}</Button>
        </div>
      </div>

      <Card>
        <CardHeader><h3 className="text-sm font-semibold text-stone-700">Fixture Details</h3></CardHeader>
        <CardBody className="space-y-4">
          <FormField label="Name"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          <div className="grid gap-4 md:grid-cols-3">
            <FormField label="Filename (reviewer sees this)"><input type="text" value={form.fileName} onChange={(e) => setForm({ ...form, fileName: e.target.value })} /></FormField>
            <FormField label="Language"><input type="text" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="ts,tsx,js,py..." /></FormField>
            <FormField label="Category"><input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="security, design, performance..." /></FormField>
          </div>
          <FormField label="Notes"><textarea rows={3} className="w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
          <FormField label="Code"><textarea rows={16} className="w-full font-mono text-xs" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-700">Expected Findings</h3>
            <Button variant="secondary" size="sm" onClick={() => setForm({ ...form, findings: [...form.findings, { ...EMPTY_FINDING }] })}>Add Finding</Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {form.findings.map((finding, index) => (
            <div key={index} className="rounded-md border border-stone-200 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-sm font-medium text-stone-700">Finding {index + 1}</h4>
                {form.findings.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, findings: form.findings.filter((_, i) => i !== index) })}>Remove</Button>
                )}
              </div>
              <div className="space-y-4">
                <FormField label="Title"><input type="text" value={finding.title} className="w-full" onChange={(e) => updateFinding(form, setForm, index, { title: e.target.value })} /></FormField>
                <FormField label="Description"><textarea rows={3} value={finding.description} className="w-full" onChange={(e) => updateFinding(form, setForm, index, { description: e.target.value })} /></FormField>
                <div className="grid gap-4 md:grid-cols-3">
                  <FormField label="Severity">
                    <Select
                      value={finding.severity}
                      onValueChange={(value) => updateFinding(form, setForm, index, { severity: value as Severity })}
                      options={[
                        { value: "critical", label: "Critical" },
                        { value: "warning", label: "Warning" },
                        { value: "suggestion", label: "Suggestion" },
                      ]}
                    />
                  </FormField>
                  <FormField label="Line Hint"><input type="text" value={finding.lineHint} className="w-full" onChange={(e) => updateFinding(form, setForm, index, { lineHint: e.target.value })} /></FormField>
                  <FormField label="Tags (comma-separated)"><input type="text" value={finding.tags.join(", ")} className="w-full" onChange={(e) => updateFinding(form, setForm, index, { tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></FormField>
                </div>
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input type="checkbox" checked={finding.required} onChange={(e) => updateFinding(form, setForm, index, { required: e.target.checked })} />
                  Required finding
                </label>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
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

function updateFinding(
  form: FixtureResponse,
  setForm: (value: FixtureResponse) => void,
  index: number,
  patch: Partial<FindingForm>,
) {
  setForm({
    ...form,
    findings: form.findings.map((finding, i) => (i === index ? { ...finding, ...patch } : finding)),
  });
}
