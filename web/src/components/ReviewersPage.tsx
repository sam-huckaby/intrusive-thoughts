import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi, apiPost, apiDelete, apiPatch } from "../hooks/useApi";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Switch } from "./ui/Switch";
import { Card } from "./ui/Card";
import { Dialog, DialogTitle, DialogDescription } from "./ui/Dialog";

interface Profile {
  id: number;
  slug: string;
  name: string;
  description: string;
  file_patterns: string;
  enabled: number;
  rule_count: number;
  update_available: number;
}

export function ReviewersPage() {
  const { data: profiles, loading, refetch } = useApi<Profile[]>("/api/profiles");
  const [showCreate, setShowCreate] = useState(false);

  if (loading) return <LoadingState />;

  async function handleCreate(data: { slug: string; name: string; prompt: string }) {
    await apiPost("/api/profiles", data);
    setShowCreate(false);
    refetch();
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/profiles/${id}`);
    refetch();
  }

  async function handleToggle(id: number) {
    await apiPatch(`/api/profiles/${id}/toggle`);
    refetch();
  }

  return (
    <div>
      <PageHeader onAdd={() => setShowCreate(true)} />
      <CreateDialog open={showCreate} onOpenChange={setShowCreate} onSubmit={handleCreate} />
      <ProfilesTable
        profiles={profiles ?? []}
        onDelete={handleDelete}
        onToggle={handleToggle}
      />
    </div>
  );
}

// ─── Page Header ─────────────────────────────────────────

function PageHeader({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-stone-900">Reviewer Profiles</h2>
        <p className="mt-1 text-sm text-stone-500">
          Manage reviewer personas with specialized prompts and file-pattern matching.
        </p>
      </div>
      <Button onClick={onAdd}>Add Profile</Button>
    </div>
  );
}

// ─── Create Dialog ───────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { slug: string; name: string; prompt: string }) => void;
}

function CreateDialog({ open, onOpenChange, onSubmit }: CreateDialogProps) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !name.trim()) return;
    onSubmit({
      slug: slug.trim(),
      name: name.trim(),
      prompt: `You are a code reviewer.\n\n{{task_summary}}\n\n{{rules}}\n\n{{diff}}`,
    });
    setSlug("");
    setName("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>Create Reviewer Profile</DialogTitle>
      <DialogDescription>
        Create a new reviewer persona. You can edit the prompt, file patterns, and linked rules after creation.
      </DialogDescription>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-stone-700">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="e.g. node-backend"
          />
          <p className="mt-1 text-xs text-stone-400">
            Lowercase identifier. Used in MCP parameters and API calls.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-stone-700">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Node.js Backend Reviewer"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit">Create</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Profiles Table ──────────────────────────────────────

interface ProfilesTableProps {
  profiles: Profile[];
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
}

function ProfilesTable({ profiles, onDelete, onToggle }: ProfilesTableProps) {
  if (profiles.length === 0) return <EmptyState />;

  return (
    <Card>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-xs font-medium uppercase tracking-wider text-stone-400">
            <th className="px-5 py-3">Profile</th>
            <th className="px-5 py-3">File Patterns</th>
            <th className="px-5 py-3">Rules</th>
            <th className="px-5 py-3">Enabled</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              onDelete={onDelete}
              onToggle={onToggle}
            />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ProfileRow({
  profile,
  onDelete,
  onToggle,
}: {
  profile: Profile;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
}) {
  const navigate = useNavigate();
  const patterns: string[] = JSON.parse(profile.file_patterns);

  return (
    <tr className="group transition-colors hover:bg-stone-50/80">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-stone-800">{profile.name}</span>
          {profile.update_available > 0 && (
            <Badge variant="warning">Update</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-stone-400">{profile.slug}</p>
        {profile.description && (
          <p className="mt-0.5 text-xs text-stone-400 line-clamp-1">{profile.description}</p>
        )}
      </td>
      <td className="px-5 py-3.5">
        <div className="flex flex-wrap gap-1">
          {patterns.slice(0, 3).map((p, i) => (
            <span
              key={i}
              className="inline-block rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-600"
            >
              {p}
            </span>
          ))}
          {patterns.length > 3 && (
            <span className="text-xs text-stone-400">+{patterns.length - 3} more</span>
          )}
        </div>
      </td>
      <td className="px-5 py-3.5">
        <span className="text-sm text-stone-600">{profile.rule_count}</span>
      </td>
      <td className="px-5 py-3.5">
        <Switch checked={profile.enabled === 1} onCheckedChange={() => onToggle(profile.id)} />
      </td>
      <td className="px-5 py-3.5 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/reviewers/${profile.id}`)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(profile.id)}
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium text-stone-500">No reviewer profiles yet</p>
      <p className="mt-1 text-xs text-stone-400">
        Add reviewer profiles to enable multi-perspective code reviews.
      </p>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      Loading profiles...
    </div>
  );
}
