import { useState } from "react";
import { useApi, apiPost, apiDelete, apiPatch, apiPut } from "../hooks/useApi";
import { RuleForm } from "./RuleForm";
import { Button } from "./ui/Button";
import { Badge, CategoryBadge, SeverityBadge } from "./ui/Badge";
import { Switch } from "./ui/Switch";
import { Card } from "./ui/Card";
import { Dialog, DialogTitle, DialogDescription } from "./ui/Dialog";
import { FieldDiff } from "./ui/FieldDiff";

interface Rule {
  id: number;
  slug: string | null;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: number;
  update_available: number;
}

interface RuleUpdate {
  id: number;
  rule_id: number;
  new_hash: string;
  new_content: string;
  detected_at: string;
}

export function RulesPage() {
  const { data: rules, loading, refetch } = useApi<Rule[]>("/api/rules");
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [viewingUpdates, setViewingUpdates] = useState<Rule | null>(null);

  if (loading) return <LoadingState />;

  const hasUpdates = (rules ?? []).some((r) => r.update_available > 0);

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
      {hasUpdates && <UpdateBanner />}
      <RuleFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        editingRule={editingRule}
        onSubmit={handleSubmit}
        onCancel={() => setShowForm(false)}
      />
      <UpdateDialog
        rule={viewingUpdates}
        onClose={() => setViewingUpdates(null)}
        onDone={() => { setViewingUpdates(null); refetch(); }}
      />
      <RulesTable
        rules={rules ?? []}
        onEdit={openEdit}
        onDelete={async (id) => { await apiDelete(`/api/rules/${id}`); refetch(); }}
        onToggle={async (id) => { await apiPatch(`/api/rules/${id}/toggle`); refetch(); }}
        onViewUpdates={setViewingUpdates}
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

function UpdateBanner() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
      Some rules have updates available from the team's rule definitions.
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

interface UpdateDialogProps {
  rule: Rule | null;
  onClose: () => void;
  onDone: () => void;
}

function UpdateDialog({ rule, onClose, onDone }: UpdateDialogProps) {
  const { data: updates, loading } = useApi<RuleUpdate[]>(
    rule ? `/api/rules/${rule.id}/updates` : "",
  );

  if (!rule) return null;

  async function handleAdopt(updateId: number) {
    await apiPost(`/api/rules/${rule!.id}/updates/${updateId}/adopt`, {});
    onDone();
  }

  async function handleDismiss(updateId: number) {
    await apiPost(`/api/rules/${rule!.id}/updates/${updateId}/dismiss`, {});
    onDone();
  }

  // Get the latest update (highest id)
  const latestUpdate = updates?.length ? updates.reduce((latest, u) => u.id > latest.id ? u : latest, updates[0]) : null;

  return (
    <Dialog open={!!rule} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogTitle>Review Changes</DialogTitle>
      <DialogDescription>
        The on-disk rule definition has changed. Review the changes below before adopting.
      </DialogDescription>
      <div className="mt-4">
        {loading && <p className="text-sm text-stone-400">Loading...</p>}
        {latestUpdate && (() => {
          const content = JSON.parse(latestUpdate.new_content) as {
            name: string;
            description: string;
            category: string;
            severity: string;
          };

          // Check if any fields actually changed
          const hasChanges =
            content.name !== rule.name ||
            content.description !== rule.description ||
            content.category !== rule.category ||
            content.severity !== rule.severity;

          if (!hasChanges) {
            return (
              <div className="rounded-lg border border-stone-200 p-4">
                <p className="text-sm text-stone-500">No changes detected.</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => handleAdopt(latestUpdate.id)}>Dismiss</Button>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              <div className="space-y-3">
                <FieldDiff label="Name" oldValue={rule.name} newValue={content.name} />
                <FieldDiff label="Description" oldValue={rule.description} newValue={content.description} />
                <FieldDiff label="Category" oldValue={rule.category} newValue={content.category} />
                <FieldDiff label="Severity" oldValue={rule.severity} newValue={content.severity} />
              </div>
              <div className="flex gap-2 pt-2 border-t border-stone-100">
                <Button size="sm" onClick={() => handleAdopt(latestUpdate.id)}>Adopt Changes</Button>
                <Button size="sm" variant="secondary" onClick={() => handleDismiss(latestUpdate.id)}>Dismiss</Button>
              </div>
            </div>
          );
        })()}
        {!loading && !latestUpdate && (
          <p className="text-sm text-stone-400">No pending updates.</p>
        )}
      </div>
    </Dialog>
  );
}

interface RulesTableProps {
  rules: Rule[];
  onEdit: (r: Rule) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
  onViewUpdates: (r: Rule) => void;
}

function RulesTable({ rules, onEdit, onDelete, onToggle, onViewUpdates }: RulesTableProps) {
  if (rules.length === 0) return <EmptyState />;
  return (
    <Card>
      <table className="w-full text-sm">
        <TableHead />
        <tbody className="divide-y divide-stone-100">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onViewUpdates={onViewUpdates} />
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
  onViewUpdates: (r: Rule) => void;
}

function RuleRow({ rule, onEdit, onDelete, onToggle, onViewUpdates }: RuleRowProps) {
  return (
    <tr className="group transition-colors hover:bg-stone-50/80">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-stone-800">{rule.name}</span>
          {rule.update_available > 0 && (
            <button onClick={() => onViewUpdates(rule)} className="cursor-pointer">
              <Badge variant="warning">Update</Badge>
            </button>
          )}
        </div>
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
