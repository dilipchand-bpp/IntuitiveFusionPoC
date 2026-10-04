'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface SupplierContract {
  id: string;
  number: string;
  title: string | null;
  status: string;
  value: number;
  startDate: string | null;
  endDate: string | null;
  clauses: Array<{ id: string; title: string; text: string }>;
  questions: Array<{ id: string; clauseId: string | null; question: string; answer: string | null }>;
}
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

/** The full contract text for the supplier to read before it is signed, with a place to raise questions. */
export function SupplierContractView({ initial, csrf }: { initial: SupplierContract; csrf: string }) {
  const [c, setC] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ask() {
    setBusy(true);
    setError(null);
    try {
      await api(`/supplier/contracts/${c.id}/questions`, { method: 'POST', csrf, body: { question: text } });
      setC(await api<SupplierContract>(`/supplier/contracts/${c.id}`));
      setText('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6" data-testid="supplier-contract">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.status === 'EXECUTED' ? 'success' : 'warning'}>
          {c.status === 'EXECUTED' ? 'Signed' : 'Out for signature'}
        </Badge>
        <span className="text-sm text-text-muted">
          {aud.format(c.value)}, {c.startDate} to {c.endDate}
        </span>
      </div>
      <Card role="region" aria-labelledby="sc-h">
        <h2 id="sc-h" className="font-heading text-xl font-bold">
          The contract
        </h2>
        <ol className="mt-3 flex flex-col gap-4">
          {c.clauses.map((k) => (
            <li key={k.id}>
              <h3 className="font-heading font-semibold">{k.title}</h3>
              <p className="mt-1 whitespace-pre-line text-sm">{k.text}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card role="region" aria-labelledby="sq-h">
        <h2 id="sq-h" className="font-heading text-xl font-bold">
          Your questions
        </h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm" aria-label="Your questions">
          {c.questions.length === 0 && <li className="text-text-muted">You have not asked a question.</li>}
          {c.questions.map((q) => (
            <li key={q.id} className="rounded-md border border-border p-2">
              <p>{q.question}</p>
              {q.answer ? (
                <p className="mt-1 rounded bg-surface-alt p-2">Answer: {q.answer}</p>
              ) : (
                <p className="mt-1 text-text-muted">Waiting for an answer.</p>
              )}
            </li>
          ))}
        </ul>
        {c.status !== 'EXECUTED' && (
          <div className="mt-3 flex flex-col gap-2">
            <Field label="Ask a question before the contract is signed">
              <Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
            <div>
              <Button loading={busy} disabled={text.trim().length < 5} onClick={() => void ask()}>
                Send question
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
