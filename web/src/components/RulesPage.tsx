import { useState } from "react";
import { useApi, apiPost, apiDelete, apiPatch, apiPut } from "../hooks/useApi";
import { RuleForm } from "./RuleForm";
import { Button } from "./ui/Button";
import { CategoryBadge, SeverityBadge } from "./ui/Badge";
import { Switch } from "./ui/Switch";
import { Card } from "./ui/Card";
import { Dialog, DialogTitle, DialogDescription } from "./ui/Dialog";

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

  if (loading) return <LoadingState />;

  function openCreate() {
    setEditingRule(null);
    setShowForm(true);
  }

  function openEdit(rule: Rule) {
    setEditingRule(rule);
    setShowForm(true);
  }

  async function handleSubmit(data: { name: string; description: string; category: string; severity: string }) {
    if (editingRule) {
      await apiPut(`/api/rules/${editingRule.id}`, data);
    } else {
      await apiPost("/api/rules", data);
    }
    setShowForm(false);
    refetch();
  }

  return (
    <div>
      <PageHeader onAdd={openCreate} />
      <RuleFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        editingRule={editingRule}
        onSubmit={handleSubmit}
        onCancel={() => setShowForm(false)}
      />
      <RulesTable
        rules={rules ?? []}
        onEdit={openEdit}
        onDelete={async (id) => { await apiDelete(`/api/rules/${id}`); refetch(); }}
        onToggle={async (id) => { await apiPatch(`/api/rules/${id}/toggle`); refetch(); }}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading rules...
    </div>
  );
}

function PageHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Review Rules</h2>
        <p className="mt-1 text-sm text-stone-500">
          Rules are injected into every review prompt to guide the AI reviewer.
        </p>
      </div>
      <Button onClick={onAdd}>Add Rule</Button>
    </div>
  );
}

interface RuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRule: Rule | null;
  onSubmit: (data: { name: string; description: string; category: string; severity: string }) => void;
  onCancel: () => void;
}

function RuleFormDialog({ open, onOpenChange, editingRule, onSubmit, onCancel }: RuleFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{editingRule ? "Edit Rule" : "Create Rule"}</DialogTitle>
      <DialogDescription>
        {editingRule ? "Update the rule details below." : "Define a new review guideline."}
      </DialogDescription>
      <div className="mt-4">
        <RuleForm
          initial={editingRule ? { name: editingRule.name, description: editingRule.description, category: editingRule.category, severity: editingRule.severity } : undefined}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </Dialog>
  );
}

interface RulesTableProps {
  rules: Rule[];
  onEdit: (r: Rule) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
}

function RulesTable({ rules, onEdit, onDelete, onToggle }: RulesTableProps) {
  if (rules.length === 0) return <EmptyState />;
  return (
    <Card>
      <table className="w-full text-sm">
        <TableHead />
        <tbody className="divide-y divide-stone-100">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TableHead() {
  return (
    <thead>
      <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-xs font-medium uppercase tracking-wider text-stone-400">
        <th className="px-5 py-3">Rule</th>
        <th className="px-5 py-3">Category</th>
        <th className="px-5 py-3">Severity</th>
        <th className="px-5 py-3">Enabled</th>
        <th className="px-5 py-3 text-right">Actions</th>
      </tr>
    </thead>
  );
}

interface RuleRowProps {
  rule: Rule;
  onEdit: (r: Rule) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
}

function RuleRow({ rule, onEdit, onDelete, onToggle }: RuleRowProps) {
  return (
    <tr className="group transition-colors hover:bg-stone-50/80">
      <td className="px-5 py-3.5">
        <span className="font-medium text-stone-800">{rule.name}</span>
        <p className="mt-0.5 text-xs text-stone-400 line-clamp-1">{rule.description}</p>
      </td>
      <td className="px-5 py-3.5">
        <CategoryBadge category={rule.category} />
      </td>
      <td className="px-5 py-3.5">
        <SeverityBadge severity={rule.severity} />
      </td>
      <td className="px-5 py-3.5">
        <Switch checked={rule.enabled === 1} onCheckedChange={() => onToggle(rule.id)} />
      </td>
      <td className="px-5 py-3.5 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="sm" onClick={() => onEdit(rule)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(rule.id)} className="text-red-600 hover:bg-red-50 hover:text-red-700">Delete</Button>
        </div>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium text-stone-500">No rules yet</p>
      <p className="mt-1 text-xs text-stone-400">
        Add review rules to guide the AI code reviewer.
      </p>
    </Card>
  );
}
