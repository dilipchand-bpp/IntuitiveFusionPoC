import { Bot, CheckCircle2, FileText, Mic, Send } from 'lucide-react';

/**
 * Illustrative product "screenshots" built from live components (always on-brand, light/dark aware, no image weight).
 * They are labelled as illustrations because the AI in this proof of concept is simulated.
 */
export function ConversationMock() {
  return (
    <figure
      aria-label="Illustration: a procurement request drafted from a short conversation with the assistant"
      className="w-full max-w-lg rounded-lg border border-border bg-surface p-4 shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-semibold text-text">
        <Bot className="size-5 text-accent" aria-hidden="true" />
        Procurement assistant
        <span className="ml-auto rounded-full border border-accent px-2 py-0.5 text-xs text-accent">
          Simulated AI
        </span>
      </div>
      <div className="flex flex-col gap-3 py-4 text-sm">
        <p className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-primary-fg">
          Run an RFx for facilities cleaning – three-year term, about $1.2M.
        </p>
        <div className="max-w-[92%] rounded-lg rounded-bl-sm bg-surface-alt px-3 py-2 text-text">
          <p>I have drafted the request and plan. Please check these fields:</p>
          <ul className="mt-2 grid gap-1 text-xs">
            {[
              ['Category', 'Building cleaning'],
              ['Term', '36 months'],
              ['Value', 'AUD 1,200,000 · High value'],
              ['Governance', 'Independent risk sign-off added'],
            ].map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3 rounded-sm bg-surface px-2 py-1">
                <span className="text-text-muted">{k}</span>
                <span className="font-semibold">{v}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">Which business unit owns the contract?</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm text-text-muted">
        <Mic className="size-4" aria-hidden="true" />
        <span className="flex-1">Type or speak your answer…</span>
        <Send className="size-4" aria-hidden="true" />
      </div>
    </figure>
  );
}

const STAGES = ['Intake', 'Plan', 'Tender', 'Evaluate', 'Award', 'Manage', 'Report'];

export function LifecycleStrip() {
  return (
    <ol
      aria-label="The seven lifecycle stages"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
    >
      {STAGES.map((s, i) => (
        <li
          key={s}
          className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-3 text-sm font-semibold text-text"
        >
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">
            {i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function DocumentFanout() {
  const docs = ['Procurement plan', 'Tender pack', 'Scoring sheet', 'Evaluation report', 'Contract'];
  return (
    <figure
      aria-label="Illustration: one conversation produces every document"
      className="rounded-lg border border-border bg-surface p-5"
    >
      <div className="mx-auto w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg">
        One conversation
      </div>
      <div aria-hidden="true" className="mx-auto h-6 w-px bg-border-strong" />
      <ul className="grid gap-2 sm:grid-cols-5">
        {docs.map((d) => (
          <li
            key={d}
            className="flex flex-col items-center gap-1 rounded-md border border-border bg-surface-alt px-2 py-3 text-center text-xs font-semibold text-text"
          >
            <FileText className="size-5 text-accent" aria-hidden="true" />
            {d}
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </figure>
  );
}
