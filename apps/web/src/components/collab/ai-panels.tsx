'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { send, useData, useRun } from '@/components/contract/b5-shared';

// ------------------------------------------------------------------ draft risk assessment (FR-0755)
interface RiskItem {
  key: string;
  title: string;
  description: string;
  applicable: boolean | null;
  likelihood: number | null;
  impact: number | null;
  score: number | null;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  options: string[];
  mitigation: string | null;
}
interface Assessment {
  basis: string;
  model: string;
  items: RiskItem[];
  prompts: string[];
  complete: boolean;
  canEdit: boolean;
}
const LEVEL_TONE = { LOW: 'success', MEDIUM: 'warning', HIGH: 'error' } as const;

export function RiskAssessmentPanel({
  requestId,
  csrf,
  canEdit,
}: {
  requestId: string;
  csrf: string;
  canEdit: boolean;
}) {
  const [a, setA] = useState<Assessment | null | undefined>(undefined);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const r = useRun();
  const base = `/requests/${requestId}/risk-assessment`;
  useEffect(() => {
    api<Assessment>(base)
      .then(setA)
      .catch((e) => setA(e instanceof ApiError ? null : null));
  }, [base]);
  const patch = (key: string, body: unknown) =>
    r.run(`p-${key}`, async () => setA(await send<Assessment>(csrf, 'PATCH', `${base}/items/${key}`, body)));
  return (
    <Card aria-labelledby="risk-h" role="region" data-testid="risk-assessment">
      <h2 id="risk-h" className="font-heading text-xl font-bold">
        Risk assessment
      </h2>
      {a === undefined ? (
        <p className="mt-2 text-sm text-text-muted">Loading…</p>
      ) : a === null ? (
        <EmptyState
          title="No risk assessment yet"
          body="A draft proposes the risks that usually apply to this kind of procurement. You decide which apply, rate them and choose how to treat them."
          action={
            canEdit ? (
              <Button
                loading={r.busy === 'gen'}
                onClick={() =>
                  void r.run('gen', async () =>
                    setA(await send<Assessment>(csrf, 'POST', `${base}/generate`)),
                  )
                }
              >
                Draft a risk assessment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">
            Drafted for: {a.basis}. Proposed by fixed rules that stand in for an AI model ({a.model}).
          </p>
          {a.complete ? (
            <p role="status" className="mt-2 text-sm font-semibold text-success">
              The assessment is complete.
            </p>
          ) : (
            a.prompts.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm" aria-label="Still to do" data-testid="risk-prompts">
                {a.prompts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )
          )}
          <ul className="mt-3 flex flex-col gap-3">
            {a.items.map((i) => (
              <li key={i.key} className="rounded-md border border-border p-3" data-risk={i.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{i.title}</strong>
                  {i.level && (
                    <Badge tone={LEVEL_TONE[i.level]}>
                      {i.level.toLowerCase()} ({i.score})
                    </Badge>
                  )}
                  {i.applicable === false && <Badge tone="neutral">Does not apply</Badge>}
                </div>
                <p className="mt-1 text-sm text-text-muted">{i.description}</p>
                {canEdit && !a.complete && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Field label={`Does "${i.title}" apply?`}>
                      <Select
                        value={i.applicable === null ? '' : i.applicable ? 'yes' : 'no'}
                        onChange={(e) =>
                          e.target.value && void patch(i.key, { applicable: e.target.value === 'yes' })
                        }
                        className="w-56"
                      >
                        <option value="">Not decided</option>
                        <option value="yes">It applies</option>
                        <option value="no">It does not apply</option>
                      </Select>
                    </Field>
                    {i.applicable && (
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label={`Likelihood of ${i.title} (1 to 5)`}>
                          <Select
                            value={i.likelihood ?? ''}
                            onChange={(e) => void patch(i.key, { likelihood: Number(e.target.value) })}
                            className="w-24"
                          >
                            <option value="">–</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={`Impact of ${i.title} (1 to 5)`}>
                          <Select
                            value={i.impact ?? ''}
                            onChange={(e) => void patch(i.key, { impact: Number(e.target.value) })}
                            className="w-24"
                          >
                            <option value="">–</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={`Treatment for ${i.title}`}>
                          <Select
                            value={i.options.includes(i.mitigation ?? '') ? (i.mitigation ?? '') : ''}
                            onChange={(e) =>
                              e.target.value && void patch(i.key, { mitigation: e.target.value })
                            }
                            className="w-80"
                          >
                            <option value="">Choose an option</option>
                            {i.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    )}
                    {i.applicable && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label={`Or write your own treatment for ${i.title}`}>
                          <Input
                            value={custom[i.key] ?? ''}
                            onChange={(e) => setCustom({ ...custom, [i.key]: e.target.value })}
                            className="w-80"
                          />
                        </Field>
                        <Button
                          variant="secondary"
                          disabled={(custom[i.key] ?? '').trim().length < 5}
                          onClick={() => void patch(i.key, { mitigation: custom[i.key] })}
                        >
                          Use it
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {i.mitigation && <p className="mt-1 text-sm">Treatment: {i.mitigation}</p>}
              </li>
            ))}
          </ul>
          {canEdit && !a.complete && (
            <div className="mt-3">
              <Button
                loading={r.busy === 'done'}
                onClick={() =>
                  void r.run(
                    'done',
                    async () => setA(await send<Assessment>(csrf, 'POST', `${base}/complete`)),
                    'The assessment is complete.',
                  )
                }
              >
                Complete the assessment
              </Button>
            </div>
          )}
        </>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ instructions in plain language (FR-0750, FR-0770, FR-0775)
interface Pick {
  id: string;
  name: string;
}
export function InstructBox({
  title,
  label,
  hint,
  path,
  csrf,
  button,
  onDone,
  testId,
}: {
  title: string;
  label: string;
  hint: string;
  path: string;
  csrf: string;
  button: string;
  onDone?: () => void;
  testId: string;
}) {
  const [text, setText] = useState('');
  const [pickList, setPickList] = useState<Pick[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const r = useRun();
  const go = (userId?: string) =>
    r.run('go', async () => {
      const x = await send<{
        status?: string;
        message?: string;
        candidates?: Pick[];
        to?: string;
        changed?: boolean;
      }>(csrf, 'POST', path, { instruction: text, ...(userId ? { userId } : {}) });
      if (x.status === 'AMBIGUOUS') {
        setPickList(x.candidates ?? []);
        setResult(x.message ?? null);
        return;
      }
      setPickList(null);
      setResult(x.message ?? (x.to ? `Moved to ${x.to.toLowerCase().replace('_', ' ')}.` : 'Done.'));
      setText('');
      onDone?.();
    });
  return (
    <Card aria-labelledby={`${testId}-h`} role="region" data-testid={testId}>
      <h2 id={`${testId}-h`} className="font-heading text-xl font-bold">
        {title}
      </h2>
      <form
        className="mt-2 flex flex-col gap-2"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          setPickList(null);
          void go();
        }}
      >
        <Field label={label} hint={hint}>
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
        </Field>
        <div>
          <Button
            type="submit"
            variant="secondary"
            loading={r.busy === 'go'}
            disabled={text.trim().length < 3}
          >
            {button}
          </Button>
        </div>
      </form>
      {pickList && (
        <fieldset className="mt-3" data-testid="picker">
          <legend className="text-sm font-semibold">{result}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {pickList.map((p) => (
              <Button key={p.id} variant="secondary" onClick={() => void go(p.id)}>
                {p.name}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
      {!pickList && result && (
        <p role="status" className="mt-2 text-sm font-medium text-success">
          {result}
        </p>
      )}
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ summaries of supplier responses (FR-0760)
interface Summaries {
  named: boolean;
  summaries: Array<{
    supplier: string;
    pricing: string;
    dates: string;
    variations: string[];
    pros: string[];
    cons: string[];
  }>;
  note: string;
}
export function ResponseSummaries({ tenderId }: { tenderId: string }) {
  const { data, error } = useData<Summaries>(`/tenders/${tenderId}/response-summaries`);
  return (
    <Card aria-labelledby="rs-h" role="region" data-testid="response-summaries">
      <h2 id="rs-h" className="font-heading text-xl font-bold">
        Summary of the responses
      </h2>
      {error && <p className="mt-2 text-sm text-text-muted">{error}</p>}
      {!data && !error && <p className="mt-2 text-sm text-text-muted">Loading…</p>}
      {data && (
        <>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {data.summaries.map((s) => (
              <li key={s.supplier} className="rounded-md border border-border p-3 text-sm">
                <h3 className="font-heading font-semibold">{s.supplier}</h3>
                <p className="mt-1">{s.pricing}</p>
                <p className="mt-1 text-text-muted">{s.dates}</p>
                {s.variations.length > 0 && (
                  <>
                    <p className="mt-2 font-semibold">Changes it proposes to the tender</p>
                    <ul className="list-disc pl-5">
                      {s.variations.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </>
                )}
                {s.pros.length > 0 && (
                  <>
                    <p className="mt-2 font-semibold text-success">In its favour</p>
                    <ul className="list-disc pl-5">
                      {s.pros.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </>
                )}
                {s.cons.length > 0 && (
                  <>
                    <p className="mt-2 font-semibold text-error">Against it</p>
                    <ul className="list-disc pl-5">
                      {s.cons.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">{data.note}</p>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ reference content corpus (FR-0765)
interface Reference {
  generation: number;
  generatedAt: string | null;
  refreshEveryDays: number;
  total: number;
  items: Array<{ id: string; title: string; level: string; sector: string; category: string; body: string }>;
  kinds: string[];
  categories: string[];
}
export function ReferenceContent({ csrf, canRefresh }: { csrf: string; canRefresh: boolean }) {
  const [level, setLevel] = useState('');
  const { data, reload } = useData<Reference>(`/reference-content${level ? `?level=${level}` : ''}`);
  const r = useRun();
  return (
    <Card aria-labelledby="ref-h" role="region" data-testid="reference-content">
      <h2 id="ref-h" className="font-heading text-xl font-bold">
        Best-practice reference content
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        Variants of common role descriptions across categories, sectors and experience levels, kept in this
        organisation&apos;s own corpus and renewed
        {data ? ` every ${data.refreshEveryDays} days` : ''} so drafting draws on current practice. Nothing
        leaves the platform.
      </p>
      {data && (
        <p className="mt-2 text-sm" data-testid="reference-generation">
          Generation {data.generation}, {data.total} variant(s)
          {data.generatedAt ? `, made ${data.generatedAt.slice(0, 10)}` : ''}.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <Field label="Experience level">
          <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-48">
            <option value="">All levels</option>
            {['Junior', 'Intermediate', 'Senior'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {canRefresh && (
          <Button
            variant="secondary"
            loading={r.busy === 'refresh'}
            onClick={() =>
              void r.run(
                'refresh',
                async () => {
                  await send(csrf, 'POST', '/reference-content/refresh');
                  await reload();
                },
                'Regenerated as a new generation.',
              )
            }
          >
            Refresh now
          </Button>
        )}
      </div>
      <Table caption="Reference content" className="mt-3">
        <thead>
          <tr>
            <Th>Role</Th>
            <Th>Sector</Th>
            <Th>Description</Th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).slice(0, 12).map((i) => (
            <tr key={i.id}>
              <Td label="Role">{i.title}</Td>
              <Td label="Sector">{i.sector}</Td>
              <Td label="Description">{i.body}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {r.messages}
    </Card>
  );
}
