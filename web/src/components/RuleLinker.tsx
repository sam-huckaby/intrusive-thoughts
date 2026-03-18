import { useState } from "react";
import { useApi, apiPost } from "../hooks/useApi";
import { RuleForm } from "./RuleForm";
import { CategoryBadge, SeverityBadge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Dialog, DialogTitle, DialogDescription } from "./ui/Dialog";

interface Rule {
  id: number;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: number;
}

interface RuleLinkerProps {
  linkedRuleIds: Set<number>;
  onToggleRule: (ruleId: number, linked: boolean) => void;
}

export function RuleLinker({ linkedRuleIds, onToggleRule }: RuleLinkerProps) {
  const { data: rules, loading, refetch } = useApi<Rule[]>("/api/rules");
  const [showCreate, setShowCreate] = useState(false);

  if (loading) return <LoadingState />;

  const allRules = rules ?? [];

  async function handleCreateRule(data: {
    name: string;
    description: string;
    category: string;
    severity: string;
  }) {
    const created = await apiPost<Rule>("/api/rules", data);
    setShowCreate(false);
    refetch();
    // Auto-link the newly created rule
    onToggleRule(created.id, true);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="text-sm font-medium text-stone-700">Linked Rules</label>
        <Button variant="ghost" size="sm" onClick={() => setShowCreate(true)}>
          + Create Rule
        </Button>
      </div>

      {allRules.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-1.5">
          {allRules.map((rule) => (
            <RuleCheckbox
              key={rule.id}
              rule={rule}
              linked={linkedRuleIds.has(rule.id)}
              onToggle={(linked) => onToggleRule(rule.id, linked)}
            />
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogTitle>Create Rule</DialogTitle>
        <DialogDescription>
          Create a new review rule. It will be available globally and linked to this profile.
        </DialogDescription>
        <div className="mt-4">
          <RuleForm
            onSubmit={handleCreateRule}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      </Dialog>
    </div>
  );
}

function RuleCheckbox({
  rule,
  linked,
  onToggle,
}: {
  rule: Rule;
  linked: boolean;
  onToggle: (linked: boolean) => void;
}) {
  const isDisabled = rule.enabled === 0;

  return (
    <label
      className={[
        "flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors",
        isDisabled ? "opacity-50" : "hover:bg-stone-50",
        "cursor-pointer",
      ].join(" ")}
    >
      <input
        type="checkbox"
        checked={linked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-stone-800">{rule.name}</span>
          {isDisabled && (
            <span className="text-xs text-stone-400">(disabled globally)</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-stone-400 line-clamp-1">{rule.description}</p>
        <div className="mt-1 flex items-center gap-2">
          <CategoryBadge category={rule.category} />
          <SeverityBadge severity={rule.severity} />
        </div>
      </div>
    </label>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 py-4 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading rules...
    </div>
  );
}

function EmptyState() {
  return (
    <p className="py-4 text-center text-sm text-stone-400">
      No rules available. Create one to get started.
    </p>
  );
}
