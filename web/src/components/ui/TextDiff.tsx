import { cn } from "../../lib/utils";

interface TextDiffProps {
  oldText: string;
  newText: string;
  oldLabel?: string;
  newLabel?: string;
}

type DiffLine = {
  type: "unchanged" | "added" | "removed";
  oldLine: string | null;
  newLine: string | null;
};

/**
 * Compute the Longest Common Subsequence (LCS) of two arrays.
 * Returns an array of indices pairs [oldIndex, newIndex] for matching elements.
 */
function computeLCS(oldLines: string[], newLines: string[]): [number, number][] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS length table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the actual LCS indices
  const lcs: [number, number][] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      lcs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Generate diff lines from old and new text using LCS algorithm.
 */
function generateDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lcs = computeLCS(oldLines, newLines);

  const result: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (const [lcsOldIdx, lcsNewIdx] of lcs) {
    // Add removed lines (in old but not in LCS yet)
    while (oldIdx < lcsOldIdx) {
      result.push({ type: "removed", oldLine: oldLines[oldIdx], newLine: null });
      oldIdx++;
    }

    // Add added lines (in new but not in LCS yet)
    while (newIdx < lcsNewIdx) {
      result.push({ type: "added", oldLine: null, newLine: newLines[newIdx] });
      newIdx++;
    }

    // Add unchanged line
    result.push({ type: "unchanged", oldLine: oldLines[oldIdx], newLine: newLines[newIdx] });
    oldIdx++;
    newIdx++;
  }

  // Add remaining removed lines
  while (oldIdx < oldLines.length) {
    result.push({ type: "removed", oldLine: oldLines[oldIdx], newLine: null });
    oldIdx++;
  }

  // Add remaining added lines
  while (newIdx < newLines.length) {
    result.push({ type: "added", oldLine: null, newLine: newLines[newIdx] });
    newIdx++;
  }

  return result;
}

/**
 * Merge adjacent removed and added lines into paired rows for better side-by-side display.
 */
function pairDiffLines(diffLines: DiffLine[]): { left: string | null; right: string | null; type: "unchanged" | "changed" }[] {
  const result: { left: string | null; right: string | null; type: "unchanged" | "changed" }[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    if (line.type === "unchanged") {
      result.push({ left: line.oldLine, right: line.newLine, type: "unchanged" });
      i++;
    } else if (line.type === "removed") {
      // Collect consecutive removed lines
      const removedLines: string[] = [];
      while (i < diffLines.length && diffLines[i].type === "removed") {
        removedLines.push(diffLines[i].oldLine!);
        i++;
      }

      // Collect consecutive added lines
      const addedLines: string[] = [];
      while (i < diffLines.length && diffLines[i].type === "added") {
        addedLines.push(diffLines[i].newLine!);
        i++;
      }

      // Pair them up
      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        result.push({
          left: j < removedLines.length ? removedLines[j] : null,
          right: j < addedLines.length ? addedLines[j] : null,
          type: "changed",
        });
      }
    } else {
      // Added line without preceding removed (shouldn't happen often after LCS)
      result.push({ left: null, right: line.newLine, type: "changed" });
      i++;
    }
  }

  return result;
}

export function TextDiff({ oldText, newText, oldLabel = "Current", newLabel = "New" }: TextDiffProps) {
  const diffLines = generateDiff(oldText, newText);
  const pairedLines = pairDiffLines(diffLines);

  return (
    <div className="rounded-lg border border-stone-200 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-2 border-b border-stone-200 bg-stone-50">
        <div className="px-3 py-2 text-xs font-medium text-stone-600 border-r border-stone-200">
          {oldLabel}
        </div>
        <div className="px-3 py-2 text-xs font-medium text-stone-600">
          {newLabel}
        </div>
      </div>

      {/* Diff content */}
      <div className="max-h-80 overflow-y-auto">
        {pairedLines.map((pair, idx) => (
          <div key={idx} className="grid grid-cols-2 text-sm font-mono">
            {/* Left side (old) */}
            <div
              className={cn(
                "px-3 py-1 border-r border-stone-200 whitespace-pre-wrap break-words",
                pair.type === "changed" && pair.left !== null && "bg-red-50 text-red-800",
                pair.left === null && "bg-stone-50"
              )}
            >
              {pair.left ?? ""}
            </div>

            {/* Right side (new) */}
            <div
              className={cn(
                "px-3 py-1 whitespace-pre-wrap break-words",
                pair.type === "changed" && pair.right !== null && "bg-emerald-50 text-emerald-800",
                pair.right === null && "bg-stone-50"
              )}
            >
              {pair.right ?? ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
