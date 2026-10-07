'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Table, Td, Textarea, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Flag {
  id: string;
  source: string;
  entityType: string;
  signals: Array<{ code: string; label: string }>;
  excerpt: string;
  by: string | null;
  status: 'OPEN' | 'REVIEWED';
  reviewedBy: string | null;
  at: string;
}
interface View {
  model: string;
  marker: string;
  rule: string;
  total: number;
  open: number;
  bySource: Array<{ source: string; count: number }>;
  flags: Flag[];
}
interface Inspect {
  flagged: boolean;
  marker: string | null;
  signals: Array<{ code: string; label: string }>;
  hiddenCharactersRemoved: number;
  neutralised: string;
}
const SOURCE: Record<string, string> = {
  CLARIFICATION_ANSWER: 'Clarification answer',
  RESPONSE_ANSWER: 'Tender response answer',
  LESSON: 'Lesson learned',
  LEGAL_EDIT: 'Legal edit instruction',
  SEARCH_RESULT: 'Outside search result',
  ASK_AI: 'Ask AI question',
};

/** The marker reviewers see next to supplier text that reads like instructions to an AI (SEC-AP08). */
export function InstructionFlag() {
  return <Badge tone="warning">Contains instruction-like text</Badge>;
}

/** Recent flags and an inspector showing how text is neutralised (SEC-AP08). */
export function ContentSafetyPanel({ csrf }: { csrf: string }) {
  const { data, error, reload } = useData<View>('/content-safety/flags');
  const review = useRun();
  const inspect = useRun();
  const [text, setText] = useState('');
  const [result, setResult] = useState<Inspect | null>(null);
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Recent flags</h2>
          <Badge tone="info">Rules, simulated ({data.model})</Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm">{data.rule}</p>
        <p className="mt-2 text-sm" data-testid="flag-summary">
          {data.total} flagged, {data.open} not yet reviewed.{' '}
          {data.bySource.map((s) => `${SOURCE[s.source] ?? s.source}: ${s.count}`).join('; ')}
        </p>
        {review.messages}
        {data.flags.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">Nothing has been flagged.</p>
        ) : (
          <div className="mt-3">
            <Table caption="Flagged supplier and uploaded text">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Where it came from</Th>
                  <Th>What was found</Th>
                  <Th>Excerpt (neutralised)</Th>
                  <Th>Review</Th>
                </tr>
              </thead>
              <tbody>
                {data.flags.map((f) => (
                  <tr key={f.id} data-testid="content-flag">
                    <Td label="When">
                      {new Date(f.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                    </Td>
                    <Td label="Where it came from">
                      {SOURCE[f.source] ?? f.source}
                      <span className="block text-xs text-text-muted">{f.by ? `by ${f.by}` : ''}</span>
                    </Td>
                    <Td label="What was found">
                      <InstructionFlag />
                      <ul className="mt-1 list-disc pl-4 text-xs">
                        {f.signals.map((s) => (
                          <li key={s.code}>{s.label}</li>
                        ))}
                      </ul>
                    </Td>
                    <Td label="Excerpt (neutralised)">
                      <code className="break-words text-xs">{f.excerpt}</code>
                    </Td>
                    <Td label="Review">
                      {f.status === 'OPEN' ? (
                        <Button
                          variant="secondary"
                          disabled={review.busy !== null}
                          aria-label={`Mark the ${SOURCE[f.source] ?? f.source} flag as reviewed`}
                          onClick={() =>
                            void review.run('r', async () => {
                              await send(csrf, 'POST', `/content-safety/flags/${f.id}/review`);
                              await reload();
                            })
                          }
                        >
                          Mark reviewed
                        </Button>
                      ) : (
                        <Badge tone="success">Reviewed{f.reviewedBy ? ` by ${f.reviewedBy}` : ''}</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">See how text is neutralised</h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          Paste some text. Nothing is stored. You will see what was found and the safe form an AI-labelled
          path is given.
        </p>
        <form
          className="mt-3 flex max-w-2xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void inspect.run('i', async () =>
              setResult(await send<Inspect>(csrf, 'POST', '/content-safety/inspect', { text })),
            );
          }}
        >
          <Field label="Text to inspect">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            loading={inspect.busy === 'i'}
            disabled={!text.trim() || inspect.busy !== null}
          >
            Inspect
          </Button>
          {inspect.messages}
        </form>
        {result && (
          <div className="mt-4 flex flex-col gap-2 text-sm" data-testid="inspect-result">
            {result.flagged ? (
              <InstructionFlag />
            ) : (
              <Badge tone="success">Nothing instruction-like found</Badge>
            )}
            {result.signals.length > 0 && (
              <ul className="list-disc pl-5">
                {result.signals.map((s) => (
                  <li key={s.code}>{s.label}</li>
                ))}
              </ul>
            )}
            {result.hiddenCharactersRemoved > 0 && (
              <p>{result.hiddenCharactersRemoved} hidden character(s) removed.</p>
            )}
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-alt p-3 text-xs">
              {result.neutralised}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
