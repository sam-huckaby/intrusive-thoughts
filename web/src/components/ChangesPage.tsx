import { useEffect, useMemo, useState } from "react";
import { apiPatch, apiPost } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { cn } from "../lib/utils";

interface SnapshotState {
  repoRoot: string;
  baseBranch: string;
  headSha: string;
  snapshot: {
    id: number;
    baseBranch: string;
    headSha: string;
    mergeBaseSha: string;
    diffHash: string;
    createdAt: string;
  };
  created: boolean;
}

interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "directory" | "submodule";
  expandable: boolean;
  changed: boolean;
  changeStatus: "added" | "modified" | "deleted" | "renamed" | null;
  hasChangedDescendants: boolean;
}

interface TreeResponse {
  snapshotId: number;
  path: string;
  nodes: TreeNode[];
}

interface SnapshotFileResponse {
  snapshotId: number;
  path: string;
  content: string;
}

interface StructuredDiffLine {
  type: "context" | "add" | "delete";
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface StructuredDiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: StructuredDiffLine[];
}

interface StructuredFileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  isBinary: boolean;
  hunks: StructuredDiffHunk[];
  diffSection: string;
}

interface DiffResponse {
  snapshotId: number;
  path: string;
  diff: StructuredFileDiff | null;
}

interface ThreadMessage {
  id: number;
  threadId: number;
  authorType: "user" | "agent";
  body: string;
  createdAt: string;
}

interface Thread {
  id: number;
  snapshotId: number;
  filePath: string;
  anchorKind: "file" | "line" | "range";
  startLine: number | null;
  endLine: number | null;
  state: "open" | "resolved" | "orphaned";
  orphanedReason: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

type Selection =
  | { anchorKind: "file"; startLine: null; endLine: null }
  | { anchorKind: "line"; startLine: number; endLine: number }
  | { anchorKind: "range"; startLine: number; endLine: number };

export function ChangesPage() {
  const [snapshotState, setSnapshotState] = useState<SnapshotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [treeCache, setTreeCache] = useState<Record<string, TreeNode[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const [fileContent, setFileContent] = useState<SnapshotFileResponse | null>(null);
  const [diffContent, setDiffContent] = useState<DiffResponse | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [orphanedThreads, setOrphanedThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [selection, setSelection] = useState<Selection>({ anchorKind: "file", startLine: null, endLine: null });

  useEffect(() => {
    void loadCurrentSnapshot();
  }, []);

  useEffect(() => {
    if (!snapshotState) return;
    void loadTree("");
  }, [snapshotState]);

  useEffect(() => {
    if (!snapshotState || !selectedPath) return;
    const node = findNode(selectedPath, treeCache);
    if (!node || node.kind !== "file") return;
    void loadThreads(selectedPath);
    void loadViewer(node);
  }, [snapshotState, selectedPath]);

  const treeLines = useMemo(() => buildVisibleTree(treeCache, expandedPaths), [treeCache, expandedPaths]);
  const selectedNode = selectedPath ? findNode(selectedPath, treeCache) : null;

  async function loadCurrentSnapshot() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/changes/current");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as SnapshotState;
      setSnapshotState(json);
      setTreeCache({});
      setExpandedPaths({});
      setSelectedPath(null);
      setThreads([]);
      setOrphanedThreads([]);
      setFileContent(null);
      setDiffContent(null);
      setSelection({ anchorKind: "file", startLine: null, endLine: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const json = await apiPost<SnapshotState>("/api/changes/refresh", {});
      setSnapshotState(json);
      setTreeCache({});
      setExpandedPaths({});
      setSelectedPath(null);
      setThreads([]);
      setOrphanedThreads([]);
      setFileContent(null);
      setDiffContent(null);
      setSelection({ anchorKind: "file", startLine: null, endLine: null });
    } finally {
      setRefreshing(false);
    }
  }

  async function loadTree(path: string) {
    if (!snapshotState) return;
    const key = path;
    if (treeCache[key]) return;
    const query = new URLSearchParams();
    if (path) query.set("path", path);
    const res = await fetch(`/api/changes/snapshots/${snapshotState.snapshot.id}/tree${query.size ? `?${query.toString()}` : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as TreeResponse;
    setTreeCache((prev) => ({ ...prev, [key]: json.nodes }));
    if (!selectedPath && json.nodes.length > 0 && path === "") {
      const firstFile = findFirstFile(json.nodes);
      if (firstFile) setSelectedPath(firstFile.path);
    }
  }

  async function loadViewer(node: TreeNode) {
    if (!snapshotState) return;
    setViewerLoading(true);
    setSelection({ anchorKind: "file", startLine: null, endLine: null });
    try {
      if (node.changed) {
        const diffQuery = new URLSearchParams({ path: node.path });
        const diffRes = await fetch(`/api/changes/snapshots/${snapshotState.snapshot.id}/diff?${diffQuery.toString()}`);
        if (!diffRes.ok) throw new Error(`HTTP ${diffRes.status}`);
        setDiffContent(await diffRes.json() as DiffResponse);
        setFileContent(null);
      } else {
        const fileQuery = new URLSearchParams({ path: node.path });
        const fileRes = await fetch(`/api/changes/snapshots/${snapshotState.snapshot.id}/file?${fileQuery.toString()}`);
        if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
        setFileContent(await fileRes.json() as SnapshotFileResponse);
        setDiffContent(null);
      }
    } finally {
      setViewerLoading(false);
    }
  }

  async function loadThreads(filePath: string) {
    if (!snapshotState) return;
    setThreadsLoading(true);
    try {
      const query = new URLSearchParams({ filePath });
      const [activeRes, orphanedRes] = await Promise.all([
        fetch(`/api/changes/snapshots/${snapshotState.snapshot.id}/threads?${query.toString()}`),
        fetch(`/api/changes/snapshots/${snapshotState.snapshot.id}/orphaned-threads?${query.toString()}`),
      ]);
      if (!activeRes.ok) throw new Error(`HTTP ${activeRes.status}`);
      if (!orphanedRes.ok) throw new Error(`HTTP ${orphanedRes.status}`);
      setThreads(await activeRes.json() as Thread[]);
      setOrphanedThreads(await orphanedRes.json() as Thread[]);
    } finally {
      setThreadsLoading(false);
    }
  }

  async function handleCreateThread() {
    if (!snapshotState || !selectedPath || !newComment.trim()) return;
    const created = await apiPost<Thread>(`/api/changes/snapshots/${snapshotState.snapshot.id}/threads`, {
      filePath: selectedPath,
      anchorKind: selection.anchorKind,
      startLine: selection.startLine,
      endLine: selection.endLine,
      body: newComment.trim(),
    });
    setThreads((prev) => [...prev, created]);
    setNewComment("");
    setSelection({ anchorKind: "file", startLine: null, endLine: null });
  }

  async function handleReply(threadId: number) {
    const body = replyDrafts[threadId]?.trim();
    if (!body) return;
    const updated = await apiPost<Thread>(`/api/changes/threads/${threadId}/messages`, {
      authorType: "agent",
      body,
    });
    setThreads((prev) => prev.map((thread) => thread.id === threadId ? updated : thread));
    setReplyDrafts((prev) => ({ ...prev, [threadId]: "" }));
  }

  async function handleToggleResolve(thread: Thread) {
    const updated = await apiPatch<Thread>(`/api/changes/threads/${thread.id}`, {
      state: thread.state === "resolved" ? "open" : "resolved",
    });
    setThreads((prev) => prev.map((item) => item.id === thread.id ? updated : item));
    setOrphanedThreads((prev) => prev.map((item) => item.id === thread.id ? updated : item));
  }

  async function handleToggleExpand(path: string) {
    const nextExpanded = !expandedPaths[path];
    setExpandedPaths((prev) => ({ ...prev, [path]: nextExpanded }));
    if (nextExpanded) {
      await loadTree(path);
    }
  }

  function handleSelectLine(lineNumber: number) {
    setSelection((prev) => {
      if (prev.anchorKind === "file" || prev.startLine === null) {
        return { anchorKind: "line", startLine: lineNumber, endLine: lineNumber };
      }
      if (prev.startLine === lineNumber && prev.endLine === lineNumber) {
        return { anchorKind: "file", startLine: null, endLine: null };
      }
      const start = Math.min(prev.startLine, lineNumber);
      const end = Math.max(prev.startLine, lineNumber);
      return start === end
        ? { anchorKind: "line", startLine: start, endLine: end }
        : { anchorKind: "range", startLine: start, endLine: end };
    });
  }

  if (loading) {
    return <LoadingState label="Capturing current changes..." />;
  }

  if (error || !snapshotState) {
    return (
      <Card className="border-red-200 bg-red-50 px-6 py-5 text-red-800">
        <h2 className="text-lg font-semibold">Changes workspace unavailable</h2>
        <p className="mt-2 text-sm text-red-700">{error ?? "Unknown error"}</p>
        <Button className="mt-4" variant="secondary" onClick={() => void loadCurrentSnapshot()}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ChangesHeader snapshotState={snapshotState} refreshing={refreshing} onRefresh={() => void handleRefresh()} />
      <div className="grid min-h-[75vh] grid-cols-[260px_minmax(0,1fr)_360px] gap-5">
        <Card className="overflow-hidden">
          <PaneHeader title="Repository" subtitle="Snapshot tree" />
          <div className="max-h-[75vh] overflow-auto px-3 py-3">
            {treeLines.length === 0 ? (
              <p className="px-3 py-2 text-sm text-stone-500">No tracked files in this snapshot.</p>
            ) : (
              <div className="space-y-0.5">
                {treeLines.map(({ node, depth }) => (
                  <TreeRow
                    key={node.path}
                    node={node}
                    depth={depth}
                    selected={selectedPath === node.path}
                    expanded={Boolean(expandedPaths[node.path])}
                    onToggle={() => void handleToggleExpand(node.path)}
                    onSelect={() => setSelectedPath(node.path)}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <PaneHeader
            title={selectedNode?.name ?? "Review viewer"}
            subtitle={selectedNode ? selectedNode.path : "Select a file to begin reviewing"}
            trailing={selectedNode ? <ChangeStatusBadge node={selectedNode} /> : null}
          />
          <div className="max-h-[75vh] overflow-auto bg-stone-50">
            {viewerLoading ? (
              <LoadingState label="Loading file view..." compact />
            ) : selectedNode?.kind === "directory" ? (
              <EmptyViewer message="Choose a file from the tree to browse its source or diff." />
            ) : diffContent?.diff ? (
              <DiffViewer diff={diffContent.diff} selection={selection} onSelectLine={handleSelectLine} />
            ) : fileContent ? (
              <SourceViewer content={fileContent.content} selection={selection} onSelectLine={handleSelectLine} />
            ) : (
              <EmptyViewer message="No file selected." />
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <PaneHeader
            title="Threads"
            subtitle={selectedPath ? formatSelection(selection) : "Select a file to comment"}
          />
          <div className="flex max-h-[75vh] flex-col">
            <div className="border-b border-stone-100 px-4 py-4">
              <ThreadComposer
                selectedPath={selectedPath}
                selection={selection}
                value={newComment}
                onChange={setNewComment}
                onSubmit={() => void handleCreateThread()}
              />
            </div>
            <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
              {threadsLoading ? (
                <LoadingState label="Loading threads..." compact />
              ) : threads.length === 0 ? (
                <p className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-500">
                  No comments for this file yet.
                </p>
              ) : (
                <>
                  {threads.map((thread) => (
                    <ThreadCard
                      key={thread.id}
                      thread={thread}
                      replyValue={replyDrafts[thread.id] ?? ""}
                      onReplyChange={(value) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: value }))}
                      onReply={() => void handleReply(thread.id)}
                      onToggleResolve={() => void handleToggleResolve(thread)}
                    />
                  ))}
                  {orphanedThreads.length > 0 && (
                    <div className="pt-2">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Orphaned comments</h4>
                      <div className="space-y-3 border-t border-dashed border-stone-200 pt-3">
                        {orphanedThreads.map((thread) => (
                          <ThreadCard
                            key={thread.id}
                            thread={thread}
                            replyValue={replyDrafts[thread.id] ?? ""}
                            onReplyChange={(value) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: value }))}
                            onReply={() => void handleReply(thread.id)}
                            onToggleResolve={() => void handleToggleResolve(thread)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ChangesHeader({
  snapshotState,
  refreshing,
  onRefresh,
}: {
  snapshotState: SnapshotState;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-stone-900">Changes</h2>
        <p className="mt-1 text-sm text-stone-500">
          Review the captured diff, browse the repository snapshot, and leave authoritative comment threads.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <Badge>base {snapshotState.baseBranch}</Badge>
          <Badge>{snapshotState.snapshot.headSha.slice(0, 8)}</Badge>
          <Badge variant={snapshotState.created ? "suggestion" : "default"}>
            {snapshotState.created ? "fresh snapshot" : "reused snapshot"}
          </Badge>
          <span>{snapshotState.repoRoot}</span>
        </div>
      </div>
      <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Refreshing..." : "Refresh changes"}
      </Button>
    </div>
  );
}

function PaneHeader({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-stone-100 bg-white px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
        <p className="mt-1 text-xs text-stone-500">{subtitle}</p>
      </div>
      {trailing}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const canToggle = node.kind === "directory";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        selected ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded text-stone-400 hover:bg-stone-200/60"
        onClick={canToggle ? onToggle : onSelect}
      >
        {canToggle ? (expanded ? "-" : "+") : node.kind === "submodule" ? "@" : ""}
      </button>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSelect}>
        <span className="truncate">{node.name}</span>
        {node.changed && node.changeStatus && <TinyStatusBadge status={node.changeStatus} />}
        {!node.changed && node.hasChangedDescendants && <span className="text-[10px] uppercase tracking-wide text-amber-600">contains changes</span>}
        {node.kind === "submodule" && <span className="text-[10px] uppercase tracking-wide text-stone-400">submodule</span>}
      </button>
    </div>
  );
}

function DiffViewer({ diff, selection, onSelectLine }: { diff: StructuredFileDiff; selection: Selection; onSelectLine: (line: number) => void }) {
  if (diff.isBinary) {
    return <EmptyViewer message="Binary file changes cannot be rendered inline yet." />;
  }

  return (
    <div className="font-mono text-xs text-stone-700">
      {diff.hunks.map((hunk) => (
        <div key={`${diff.path}-${hunk.header}`} className="border-b border-stone-200">
          <div className="bg-stone-200/70 px-4 py-1.5 text-[11px] text-stone-600">{hunk.header}</div>
          {hunk.lines.map((line, index) => {
            const anchorLine = line.newLineNumber ?? line.oldLineNumber;
            const selected = anchorLine !== null && isLineSelected(selection, anchorLine);
            return (
              <button
                key={`${hunk.header}-${index}`}
                type="button"
                className={cn(
                  "grid w-full grid-cols-[56px_56px_1fr] px-4 py-1 text-left",
                  line.type === "add" && "bg-emerald-50",
                  line.type === "delete" && "bg-red-50",
                  selected && "ring-1 ring-inset ring-stone-800",
                )}
                onClick={() => anchorLine !== null && onSelectLine(anchorLine)}
              >
                <span className="text-stone-400">{line.oldLineNumber ?? ""}</span>
                <span className="text-stone-400">{line.newLineNumber ?? ""}</span>
                <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SourceViewer({ content, selection, onSelectLine }: { content: string; selection: Selection; onSelectLine: (line: number) => void }) {
  const lines = content.split("\n");
  return (
    <div className="font-mono text-xs text-stone-700">
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const selected = isLineSelected(selection, lineNumber);
        return (
          <button
            key={lineNumber}
            type="button"
            className={cn(
              "grid w-full grid-cols-[56px_1fr] px-4 py-1 text-left hover:bg-stone-100",
              selected && "bg-stone-200/80 ring-1 ring-inset ring-stone-800",
            )}
            onClick={() => onSelectLine(lineNumber)}
          >
            <span className="text-stone-400">{lineNumber}</span>
            <span className="whitespace-pre-wrap break-words">{line || " "}</span>
          </button>
        );
      })}
    </div>
  );
}

function ThreadComposer({
  selectedPath,
  selection,
  value,
  onChange,
  onSubmit,
}: {
  selectedPath: string | null;
  selection: Selection;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-stone-800">New authoritative comment</p>
          <p className="mt-1 text-xs text-stone-500">{selectedPath ? `${selectedPath} - ${formatSelection(selection)}` : "Select a file first"}</p>
        </div>
        <Button size="sm" onClick={onSubmit} disabled={!selectedPath || !value.trim()}>
          Add comment
        </Button>
      </div>
      <textarea
        className="w-full"
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Describe the required change or ask a targeted question for the agent."
      />
    </div>
  );
}

function ThreadCard({
  thread,
  replyValue,
  onReplyChange,
  onReply,
  onToggleResolve,
}: {
  thread: Thread;
  replyValue: string;
  onReplyChange: (value: string) => void;
  onReply: () => void;
  onToggleResolve: () => void;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">{thread.filePath}</p>
          <p className="mt-1 text-xs text-stone-500">{threadLabel(thread)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={thread.state === "resolved" ? "approve" : thread.state === "orphaned" ? "warning" : "default"}>
            {thread.state}
          </Badge>
          <Button variant="ghost" size="sm" onClick={onToggleResolve}>
            {thread.state === "resolved" ? "Reopen" : "Resolve"}
          </Button>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {thread.orphanedReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {thread.orphanedReason}
          </div>
        )}
        {thread.messages.map((message) => (
          <div key={message.id} className={cn(
            "rounded-lg px-3 py-2 text-sm",
            message.authorType === "user" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700",
          )}>
            <div className="mb-1 text-[11px] uppercase tracking-wide opacity-70">{message.authorType}</div>
            <p className="whitespace-pre-wrap">{message.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <textarea
          rows={2}
          value={replyValue}
          onChange={(event) => onReplyChange(event.target.value)}
          placeholder="Reply as the agent to ask a clarifying question or confirm the fix plan."
        />
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={onReply} disabled={!replyValue.trim()}>
            Add reply
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChangeStatusBadge({ node }: { node: TreeNode }) {
  if (!node.changed || !node.changeStatus) return null;
  return <TinyStatusBadge status={node.changeStatus} large />;
}

function TinyStatusBadge({ status, large = false }: { status: NonNullable<TreeNode["changeStatus"]>; large?: boolean }) {
  const classes = {
    added: "bg-emerald-100 text-emerald-700",
    modified: "bg-amber-100 text-amber-700",
    deleted: "bg-red-100 text-red-700",
    renamed: "bg-sky-100 text-sky-700",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 font-medium uppercase tracking-wide",
      large ? "text-[11px]" : "text-[10px]",
      classes[status],
    )}>
      {status}
    </span>
  );
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-stone-500", compact ? "px-4 py-4" : "py-8")}>
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
      {label}
    </div>
  );
}

function EmptyViewer({ message }: { message: string }) {
  return <p className="px-6 py-8 text-sm text-stone-500">{message}</p>;
}

function buildVisibleTree(treeCache: Record<string, TreeNode[]>, expandedPaths: Record<string, boolean>) {
  const lines: Array<{ node: TreeNode; depth: number }> = [];
  const walk = (path: string, depth: number) => {
    const nodes = treeCache[path] ?? [];
    for (const node of nodes) {
      lines.push({ node, depth });
      if (node.kind === "directory" && expandedPaths[node.path]) {
        walk(node.path, depth + 1);
      }
    }
  };
  walk("", 0);
  return lines;
}

function findNode(path: string, treeCache: Record<string, TreeNode[]>) {
  for (const nodes of Object.values(treeCache)) {
    const match = nodes.find((node) => node.path === path);
    if (match) return match;
  }
  return null;
}

function findFirstFile(nodes: TreeNode[]): TreeNode | null {
  for (const node of nodes) {
    if (node.kind === "file") return node;
  }
  return null;
}

function isLineSelected(selection: Selection, lineNumber: number) {
  if (selection.anchorKind === "file") return false;
  return lineNumber >= selection.startLine && lineNumber <= selection.endLine;
}

function formatSelection(selection: Selection) {
  if (selection.anchorKind === "file") return "file comment";
  if (selection.anchorKind === "line") return `line ${selection.startLine}`;
  return `lines ${selection.startLine}-${selection.endLine}`;
}

function threadLabel(thread: Thread) {
  if (thread.anchorKind === "file") return "File comment";
  if (thread.anchorKind === "line") return `Line ${thread.startLine}`;
  return `Lines ${thread.startLine}-${thread.endLine}`;
}
