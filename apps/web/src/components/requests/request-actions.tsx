'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Dialog, Field, Input, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import type { FieldView, RequestView } from './types';

const LONG = new Set(['background', 'deliverables', 'risk']);

/** Edit-in-place for a draft, plus the Submit action with its error handling (missing fields, budget). */
export function RequestActions({
  view,
  csrf,
  canEdit,
}: {
  view: RequestView;
  csrf: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const draft = view.status === 'DRAFT';

  const beginEdit = () => {
    setValues(Object.fromEntries(view.fields.map((f: FieldView) => [f.key, f.value ?? ''])));
    setEditing(true);
    setErrors({});
    setFormError(null);
  };

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    const changed = view.fields.filter(
      (f) => (values[f.key] ?? '') !== (f.value ?? '') && (values[f.key] ?? '').trim() !== '',
    );
    try {
      if (changed.length > 0) {
        await api(`/requests/${view.id}`, {
          method: 'PATCH',
          csrf,
          body: {
            fields: Object.fromEntries(changed.map((f) => [f.key, values[f.key]!])),
            expectedVersion: view.version,
          },
        });
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setFormError(null);
    setConfirm(false);
    try {
      await api(`/requests/${view.id}/submit`, {
        method: 'POST',
        csrf,
        idempotencyKey: `submit-${view.id}-${view.version}`,
      });
      router.refresh();
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  }

  function handle(e: unknown) {
    if (!(e instanceof ApiError)) return setFormError('Something went wrong. Please try again.');
    const fe: Record<string, string> = {};
    for (const x of e.problem.errors ?? []) fe[x.field] = x.message;
    setErrors(fe);
    if (e.problem.code === 'REQUEST_INCOMPLETE')
      setFormError(
        'Some required information is missing. Edit the request or continue in the chat to add it.',
      );
    else if (e.problem.code === 'BUDGET_EXCEEDED') {
      setFormError(
        'The estimated value is more than the budget available to this business unit. Lower the value or ask Finance to amend the budget.',
      );
      router.refresh(); // the refusal is recorded server-side (budget status "Over budget"), so show it
    } else if (e.problem.code === 'VERSION_CONFLICT')
      setFormError('Someone changed this request while you were editing. Reload the page and try again.');
    else setFormError(e.message);
  }

  return (
    <section
      aria-labelledby="actions-h"
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
    >
      <h2 id="actions-h" className="font-heading text-lg font-semibold">
        Actions
      </h2>
      {formError && (
        <div
          role="alert"
          className="rounded-sm border border-error bg-error-bg p-3 text-sm font-medium text-error"
        >
          <p>{formError}</p>
          {Object.keys(errors).length > 0 && (
            <ul className="mt-1 list-disc pl-5 font-normal">
              {Object.entries(errors).map(([k, m]) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!draft && (
        <p className="text-sm text-text-muted">
          This request has been submitted and can no longer be edited here.
        </p>
      )}
      {draft && !canEdit && (
        <p className="text-sm text-text-muted">
          Only the requester or the procurement team can change or submit this request.
        </p>
      )}
      {draft && canEdit && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={beginEdit}>
            Edit fields
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/app/requests/new?request=${view.id}`} className="text-text no-underline">
              Continue in chat
            </Link>
          </Button>
          <Button
            onClick={() => setConfirm(true)}
            loading={busy}
            disabled={view.missingFields.length > 0}
            aria-describedby={view.missingFields.length > 0 ? 'submit-hint' : undefined}
          >
            Submit request
          </Button>
          {view.missingFields.length > 0 && (
            <p id="submit-hint" className="w-full text-sm text-text-muted">
              Add the missing information ({view.missingFields.length}) to enable submission.
            </p>
          )}
        </div>
      )}
      {draft && canEdit && editing && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          aria-label="Edit request fields"
        >
          {view.fields.map((f) => (
            <Field key={f.key} label={f.label} error={errors[f.key]}>
              {LONG.has(f.key) ? (
                <Textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  inputMode={f.key === 'estimatedValue' || f.key === 'termMonths' ? 'numeric' : undefined}
                />
              )}
            </Field>
          ))}
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Save changes
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit this request?"
        description="The finance system is checked for budget and the procurement team is notified. You will not be able to edit the request afterwards."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()}>Submit</Button>
          </>
        }
      />
    </section>
  );
}
