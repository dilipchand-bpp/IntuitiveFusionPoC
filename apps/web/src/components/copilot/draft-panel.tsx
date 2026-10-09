'use client';
import { ChevronDown, Sparkles, Undo2, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AiBadge, Badge, Button, cn } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { appendSpoken, useDictation } from '../voice/use-dictation';
import { VoiceButton, VoiceStatus } from '../voice/voice-button';
import { DiffList, DraftPreview } from './draft-preview';
import {
  KIND_LABEL,
  type ApplyResult,
  type DraftKind,
  type DraftView,
  type RevisionRow,
} from './draft-types';

const msg = (e: unknown) =>
  e instanceof ApiError
    ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
    : 'Something went wrong. Please try again.';

const APPLY_LABEL: Record<DraftView['defaultTarget'], string> = {
  REQUEST: 'Apply to the request',
  PLAN: 'Apply to the plan',
  TENDER: 'Apply to the tender pack',
  REPOSITORY: 'File in the document repository',
};

/**
 * "Draft with AI": say or type what is needed, read the draft with the source of every field, change it in plain language with a
 * before and after, undo, and write it into the record as yourself. Simulated, rules-based (CP-04, CP-05).
 */
export function DraftPanel({
  csrf,
  kinds,
  procurementId,
  defaultOpen = false,
  heading = 'Draft with AI',
  intro,
  idPrefix = 'aidraft',
}: {
  csrf: string;
  /** The kinds the person can choose from; one kind hides the chooser. */
  kinds: readonly DraftKind[];
  procurementId?: string | undefined;
  defaultOpen?: boolean;
  heading?: string;
  intro?: string;
  idPrefix?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<DraftKind>(kinds[0]!);
  const [text, setText] = useState('');
  const [spoken, setSpoken] = useState(false);
  const [view, setView] = useState<DraftView | null>(null);
  const [instruction, setInstruction] = useState('');
  const [last, setLast] = useState<DraftView | null>(null);
  const [revs, setRevs] = useState<RevisionRow[]>([]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voice = useDictation((s) => {
    setText((cur) => appendSpoken(cur, s));
    setSpoken(true);
  });
  const adjustVoice = useDictation((s) => {
    setInstruction((cur) => appendSpoken(cur, s));
    setAdjSpoken(true);
  });
  const [adjSpoken, setAdjSpoken] = useState(false);
  const id = (s: string) => `${idPrefix}-${s}`;

  async function run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(name);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(msg(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  const loadRevs = async (draftId: string) => {
    const r = await api<{ revisions: RevisionRow[] }>(`/copilot/draft/${draftId}/revisions`);
    setRevs(r.revisions);
  };

  async function generate() {
    if (text.trim().length < 3) return;
    const v = await run('generate', () =>
      api<DraftView>('/copilot/draft', {
        method: 'POST',
        csrf,
        body: {
          kind,
          text: text.trim(),
          source: spoken ? 'VOICE' : 'TEXT',
          ...(procurementId ? { procurementId } : {}),
        },
      }),
    );
    if (v) {
      setView(v);
      setLast(null);
      setResult(null);
      setRevs([]);
      await loadRevs(v.id).catch(() => undefined);
    }
  }
  async function adjust(text0?: string) {
    const ins = (text0 ?? instruction).trim();
    if (!view || !ins) return;
    const v = await run('adjust', () =>
      api<DraftView>(`/copilot/draft/${view.id}/adjust`, {
        method: 'POST',
        csrf,
        body: { instruction: ins, source: adjSpoken ? 'VOICE' : 'TEXT' },
      }),
    );
    if (v) {
      setView(v);
      setLast(v);
      setResult(null);
      if (v.applied) setInstruction('');
      setAdjSpoken(false);
      await loadRevs(v.id).catch(() => undefined);
    }
  }
  async function undo() {
    if (!view) return;
    const v = await run('undo', () =>
      api<DraftView>(`/copilot/draft/${view.id}/undo`, { method: 'POST', csrf }),
    );
    if (v) {
      setView(v);
      setLast(v);
      setResult(null);
      await loadRevs(v.id).catch(() => undefined);
    }
  }
  async function apply() {
    if (!view) return;
    const r = await run('apply', () =>
      api<ApplyResult>(`/copilot/draft/${view.id}/apply`, {
        method: 'POST',
        csrf,
        body: procurementId ? { procurementId } : {},
      }),
    );
    if (r) setResult(r);
  }

  const canUndo = revs.length > 1 && revs[0]?.action !== 'GENERATE';
  return (
    <section
      data-testid={id('panel')}
      aria-labelledby={id('heading')}
      className="min-w-0 rounded-md border border-border bg-surface"
    >
      <h2 id={id('heading')} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id('body')}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left font-heading text-lg font-semibold focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Sparkles className="size-5 text-accent" aria-hidden="true" />
          {heading}
          <span className="ml-2">
            <AiBadge />
          </span>
          <ChevronDown
            className={cn('ml-auto size-5 transition-transform', !open && '-rotate-90')}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div id={id('body')} hidden={!open} className="flex flex-col gap-5 border-t border-border p-4">
        <p className="max-w-prose text-sm text-text-muted">
          {intro ??
            'Say or type what you need. The draft is built by fixed rules (simulated, rules-simulated-v1) and shows where every field came from. Nothing is written to a record until you apply it, and then only as you.'}
        </p>

        <form
          aria-label="Describe what you need"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
          className="flex flex-col gap-2"
        >
          {kinds.length > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor={id('kind')} className="text-sm font-medium">
                What to draft
              </label>
              <select
                id={id('kind')}
                value={kind}
                onChange={(e) => setKind(e.target.value as DraftKind)}
                className="min-h-[44px] max-w-sm rounded-sm border border-border-strong bg-surface px-3 text-sm"
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label htmlFor={id('text')} className="text-sm font-medium">
            What do you need?
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <textarea
              id={id('text')}
              data-testid={id('text')}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSpoken(false);
              }}
              rows={3}
              maxLength={6000}
              placeholder="For example: We need a managed print service for 40 sites, about $450k over 3 years, starting next March, must be hosted in Australia"
              className="min-h-[44px] min-w-0 basis-full resize-y rounded-sm border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted sm:flex-1 sm:basis-0"
            />
            <VoiceButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
            <Button
              type="submit"
              data-testid={id('generate')}
              loading={busy === 'generate'}
              disabled={text.trim().length < 3}
            >
              <Wand2 className="size-4" aria-hidden="true" />
              Draft it
            </Button>
          </div>
          <VoiceStatus state={voice.state} interim={voice.interim} error={voice.error} />
        </form>

        {error && (
          <p
            role="alert"
            data-testid={id('error')}
            className="rounded-sm border border-error bg-error-bg p-2 text-sm font-medium text-error"
          >
            {error}
          </p>
        )}

        {view && (
          <>
            <DraftPreview view={view} />

            <form
              aria-label="Adjust the draft"
              onSubmit={(e) => {
                e.preventDefault();
                void adjust();
              }}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface-alt p-3"
            >
              <label htmlFor={id('adjust')} className="text-sm font-medium">
                Change it in your own words
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <input
                  id={id('adjust')}
                  data-testid={id('adjust-input')}
                  value={instruction}
                  onChange={(e) => {
                    setInstruction(e.target.value);
                    setAdjSpoken(false);
                  }}
                  maxLength={1000}
                  placeholder="For example: change the budget to 500k"
                  className="min-h-[44px] min-w-0 basis-full rounded-sm border border-border-strong bg-surface px-3 text-sm sm:flex-1 sm:basis-0"
                />
                <VoiceButton
                  state={adjustVoice.state}
                  onStart={adjustVoice.start}
                  onStop={adjustVoice.stop}
                />
                <Button
                  type="submit"
                  data-testid={id('adjust-submit')}
                  variant="secondary"
                  loading={busy === 'adjust'}
                  disabled={!instruction.trim()}
                >
                  Adjust
                </Button>
              </div>
              <VoiceStatus
                state={adjustVoice.state}
                interim={adjustVoice.interim}
                error={adjustVoice.error}
              />
              <ul className="flex flex-wrap gap-2" aria-label="Examples you can try">
                {view.adjustExamples.map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      data-testid={id('chip')}
                      onClick={() => setInstruction(ex)}
                      className="min-h-[36px] rounded-full border border-border-strong bg-surface px-3 text-xs font-medium hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {ex}
                    </button>
                  </li>
                ))}
              </ul>
            </form>

            {last && last.applied === false && (
              <div
                role="status"
                data-testid={id('refusal')}
                className="rounded-sm border border-warning bg-warning-bg p-3 text-sm"
              >
                <p className="font-semibold text-warning">{last.message}</p>
                {last.reason === 'NOT_UNDERSTOOD' && last.examples && (
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                    {last.examples.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {last && last.applied && (
              <div data-testid={id('change')} className="flex flex-col gap-2">
                <h4 className="font-heading text-base font-semibold">What changed</h4>
                <p role="status" className="text-sm">
                  {last.summary}
                </p>
                <DiffList diff={last.diff ?? []} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                data-testid={id('undo')}
                onClick={() => void undo()}
                loading={busy === 'undo'}
                disabled={!canUndo}
              >
                <Undo2 className="size-4" aria-hidden="true" />
                Undo
              </Button>
              <Button
                type="button"
                data-testid={id('apply')}
                onClick={() => void apply()}
                loading={busy === 'apply'}
              >
                {APPLY_LABEL[view.defaultTarget]}
              </Button>
              {!procurementId && view.defaultTarget !== 'REQUEST' && (
                <span className="text-sm text-text-muted">
                  Open a procurement and draft there to apply this.
                </span>
              )}
            </div>
            {result && (
              <p
                role="status"
                data-testid={id('result')}
                className="rounded-sm border border-success bg-success-bg p-3 text-sm font-medium text-success"
              >
                {result.applied ? (
                  <>
                    Applied {result.changes.length} change{result.changes.length === 1 ? '' : 's'} as you.{' '}
                    {result.targetUrl && (
                      <Link href={result.targetUrl} className="underline">
                        Open it
                      </Link>
                    )}
                  </>
                ) : (
                  (result.message ?? 'The change was queued as a task.')
                )}
              </p>
            )}

            <details className="text-sm" data-testid={id('revisions')}>
              <summary className="cursor-pointer font-semibold">Revisions ({revs.length})</summary>
              <ol className="mt-2 flex flex-col gap-2">
                {revs.map((r) => (
                  <li
                    key={r.revision}
                    data-testid={id('revision')}
                    className="rounded-sm border border-border p-2"
                  >
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      Revision {r.revision}
                      <Badge tone={r.action === 'UNDO' ? 'warning' : 'neutral'}>
                        {r.action.toLowerCase()}
                      </Badge>
                    </p>
                    <p className="text-text-muted">
                      {r.instruction ? `“${r.instruction}”: ` : ''}
                      {r.summary}
                    </p>
                    {r.diff.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-medium">
                          Before and after ({r.diff.length})
                        </summary>
                        <div className="mt-1">
                          <DiffList diff={r.diff} />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
