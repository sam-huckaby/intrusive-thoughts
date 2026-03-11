import { useState } from "react";
import { useApi, apiPost, apiDelete, apiPatch, apiPut } from "../hooks/useApi";
import { RuleForm } from "./RuleForm";

interface Rule {
  id: number;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: number;
}

export function RulesPage() {
  const { data: rules, loading, refetch } = useApi<Rule[]>("/api/rules");
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  if (loading) return <p className="text-gray-500">Loading rules...</p>;

  return (
    <div>
      <Header onAdd={() => { setEditingRule(null); setShowForm(true); }} />
      {showForm && (
        <RuleForm
          initial={editingRule ? { name: editingRule.name, description: editingRule.description, category: editingRule.category, severity: editingRule.severity } : undefined}
          onSubmit={async (data) => {
            if (editingRule) {
              await apiPut(`/api/rules/${editingRule.id}`, data);
            } else {
              await apiPost("/api/rules", data);
            }
            setShowForm(false);
            refetch();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
      <RulesTable rules={rules ?? []} onEdit={(r) => { setEditingRule(r); setShowForm(true); }} onDelete={async (id) => { await apiDelete(`/api/rules/${id}`); refetch(); }} onToggle={async (id) => { await apiPatch(`/api/rules/${id}/toggle`); refetch(); }} />
    </div>
  );
}

function Header({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex justify-between items-center mb-6">
      <h2 className="text-2xl font-bold">Review Rules</h2>
      <button onClick={onAdd} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Add Rule</button>
    </div>
  );
}

function RulesTable({ rules, onEdit, onDelete, onToggle }: { rules: Rule[]; onEdit: (r: Rule) => void; onDelete: (id: number) => void; onToggle: (id: number) => void }) {
  return (
    <table className="w-full bg-white rounded border text-sm">
      <thead><tr className="border-b bg-gray-50"><th className="p-3 text-left">Name</th><th className="p-3 text-left">Category</th><th className="p-3 text-left">Severity</th><th className="p-3 text-left">Enabled</th><th className="p-3 text-left">Actions</th></tr></thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.id} className="border-b hover:bg-gray-50">
            <td className="p-3 font-medium">{rule.name}</td>
            <td className="p-3"><Badge text={rule.category} color="blue" /></td>
            <td className="p-3"><SeverityBadge severity={rule.severity} /></td>
            <td className="p-3"><button onClick={() => onToggle(rule.id)} className={`px-2 py-1 rounded text-xs ${rule.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>{rule.enabled ? "On" : "Off"}</button></td>
            <td className="p-3 space-x-2"><button onClick={() => onEdit(rule)} className="text-blue-600 hover:underline text-xs">Edit</button><button onClick={() => onDelete(rule.id)} className="text-red-600 hover:underline text-xs">Delete</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs bg-${color}-100 text-${color}-800`}>{text}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = { critical: "red", warning: "yellow", suggestion: "gray" };
  const color = colors[severity] ?? "gray";
  return <Badge text={severity} color={color} />;
}
