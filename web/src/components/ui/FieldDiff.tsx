import { TextDiff } from "./TextDiff";

interface FieldDiffProps {
  label: string;
  oldValue: string;
  newValue: string;
}

/**
 * Displays a before/after comparison for a single field.
 * Only renders if the values differ.
 * Uses inline display for short values, TextDiff for longer text.
 */
export function FieldDiff({ label, oldValue, newValue }: FieldDiffProps) {
  // Don't render if values are the same
  if (oldValue === newValue) {
    return null;
  }

  // Use TextDiff for multi-line or long values (description)
  const isLongText = oldValue.length > 80 || newValue.length > 80 || oldValue.includes("\n") || newValue.includes("\n");

  if (isLongText) {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-stone-700">{label}</h4>
        <TextDiff oldText={oldValue} newText={newValue} />
      </div>
    );
  }

  // Inline display for short single-line values
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium text-stone-700">{label}</h4>
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded bg-red-50 px-2 py-0.5 text-red-700 line-through">
          {oldValue}
        </span>
        <span className="text-stone-400">&rarr;</span>
        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
          {newValue}
        </span>
      </div>
    </div>
  );
}
