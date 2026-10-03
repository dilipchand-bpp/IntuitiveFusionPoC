'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Badge, Button, Card, Dialog, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface WorkflowRow {
  id: string;
  name: string;
  tier: 'SIMPLE' | 'INTERMEDIATE' | 'COMPLEX';
  editable: boolean;
  steps: Array<{ key: string; label: string; mandatory: boolean }>;
}

const TIER: Record<WorkflowRow['tier'], string> = {
  SIMPLE: 'Simple',
  INTERMEDIATE: 'Intermediate',
  COMPLEX: 'Complex',
};
const message = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)]
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' ')
    : 'Something went wrong. Please try again.';

/** The workflow library. The simple workflow can be edited; the others are shown and marked coming soon. */
export function WorkflowsPanel({
  initial,
  csrf,
  canEdit,
}: {
  initial: WorkflowRow[];
  csrf: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<WorkflowRow | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Array<{ label: string; mandatory: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<WorkflowRow>(`/admin/workflows/${editing.id}`, {
        method: 'PUT',
        csrf,
        body: { name, steps: steps.filter((s) => s.label.trim()) },
      });
      setList(list.map((w) => (w.id === next.id ? next : w)));
      setNote(`${next.name} was saved.`);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSteps(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {note && (
        <p
          role="status"
          className="rounded-md border border-success bg-success-bg p-3 text-sm font-medium text-success"
          data-testid="workflow-note"
        >
          {note}
        </p>
      )}
      <ul className="grid gap-4 lg:grid-cols-3" aria-label="Workflows">
        {list.map((w) => (
          <li key={w.id}>
            <Card aria-labelledby={`wf-${w.id}`} role="region" data-testid={`workflow-${w.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`wf-${w.id}`} className="font-heading text-lg font-bold">
                  {w.name}
                </h2>
                <Badge tone="info">{TIER[w.tier]}</Badge>
              </div>
              <ol className="mt-3 flex flex-col gap-1 text-sm">
                {w.steps.map((s, i) => (
                  <li key={s.key} className="flex items-center justify-between gap-2">
                    <span>
                      {i + 1}. {s.label}
                    </span>
                    <Badge tone={s.mandatory ? 'neutral' : 'info'}>
                      {s.mandatory ? 'Mandatory' : 'Optional'}
                    </Badge>
                  </li>
                ))}
              </ol>
              <div className="mt-3">
                {w.editable && canEdit ? (
                  <Button
                    variant="secondary"
                    aria-label={`Edit ${w.name}`}
                    onClick={() => {
                      setEditing(w);
                      setName(w.name);
                      setSteps(w.steps.map((s) => ({ label: s.label, mandatory: s.mandatory })));
                      setError(null);
                    }}
                  >
                    Edit workflow
                  </Button>
                ) : w.editable ? null : (
                  <Badge tone="warning">Editing coming soon</Badge>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Edit ${editing?.name ?? ''}`}
        description="Rename, reorder, add or remove steps and mark steps optional. An approval checkpoint is a policy: it must stay and stay mandatory."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Save workflow
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Workflow name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {steps.map((s, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label={`Step ${i + 1}`}>
                <Input
                  value={s.label}
                  onChange={(e) =>
                    setSteps(steps.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--if-color-accent)]"
                  checked={s.mandatory}
                  onChange={(e) =>
                    setSteps(steps.map((x, j) => (j === i ? { ...x, mandatory: e.target.checked } : x)))
                  }
                  aria-label={`Step ${i + 1} is mandatory`}
                />
                Mandatory
              </label>
              <Button
                variant="ghost"
                aria-label={`Move step ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move step ${i + 1} down`}
                disabled={i === steps.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Remove step ${i + 1}`}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              disabled={steps.length >= 12}
              onClick={() => setSteps([...steps, { label: '', mandatory: true }])}
            >
              Add a step
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
