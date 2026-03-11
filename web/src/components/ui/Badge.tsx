import { cn } from "../../lib/utils";

type BadgeVariant =
  | "default"
  | "critical"
  | "warning"
  | "suggestion"
  | "nitpick"
  | "approve"
  | "request_changes"
  | "style"
  | "security"
  | "performance"
  | "architecture"
  | "maintainability"
  | "general";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-stone-100 text-stone-700",
  critical: "bg-red-50 text-red-700 ring-1 ring-red-200",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  suggestion: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  nitpick: "bg-stone-50 text-stone-500 ring-1 ring-stone-200",
  approve: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  request_changes: "bg-red-50 text-red-700 ring-1 ring-red-200",
  style: "bg-sky-50 text-sky-700",
  security: "bg-red-50 text-red-700",
  performance: "bg-amber-50 text-amber-700",
  architecture: "bg-teal-50 text-teal-700",
  maintainability: "bg-stone-100 text-stone-600",
  general: "bg-stone-50 text-stone-500",
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
      VARIANT_CLASSES[variant],
      className,
    )}>
      {children}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const isApproved = verdict === "approve";
  return (
    <Badge variant={isApproved ? "approve" : "request_changes"}>
      {isApproved ? "Approved" : "Changes Requested"}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const variant = (
    severity === "critical" || severity === "warning" ||
    severity === "suggestion" || severity === "nitpick"
  ) ? severity as BadgeVariant : "default";
  return <Badge variant={variant}>{severity}</Badge>;
}

export function CategoryBadge({ category }: { category: string }) {
  const variant = (
    category === "style" || category === "security" ||
    category === "performance" || category === "architecture" ||
    category === "maintainability" || category === "general"
  ) ? category as BadgeVariant : "default";
  return <Badge variant={variant}>{category}</Badge>;
}
