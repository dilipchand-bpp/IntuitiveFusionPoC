import {
  Award,
  BarChart3,
  Bot,
  CheckCircle2,
  ClipboardList,
  FileSignature,
  FileText,
  Inbox,
  Mic,
  Scale,
  Send,
  ShieldCheck,
  Stamp,
  type LucideIcon,
} from 'lucide-react';

/**
 * Illustrative product "screenshots" built from live components (always on-brand, light/dark aware, no image weight).
 * They are labelled as illustrations because the AI in this proof of concept is simulated.
 */
export function ConversationMock() {
  return (
    <div className="relative w-full max-w-lg">
      <div
        aria-hidden="true"
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-brand-gradient opacity-20 blur-3xl"
      />
      <figure
        aria-label="Illustration: a procurement request drafted from a short conversation with the assistant"
        className="float w-full rounded-lg border border-border bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-semibold text-text">
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-brand-gradient">
            <Bot className="size-5" aria-hidden="true" />
          </span>
          Procurement assistant
          <span className="ml-auto rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
            Simulated AI
          </span>
        </div>
        <div className="flex flex-col gap-3 py-4 text-sm">
          <p className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-brand-gradient px-3 py-2 shadow-sm">
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
                <li
                  key={k}
                  className="flex justify-between gap-3 rounded-sm bg-surface px-2 py-1.5 shadow-sm"
                >
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
      <p
        aria-hidden="true"
        className="float absolute -left-8 -top-5 hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-text shadow-lg [animation-delay:-2s] lg:flex"
      >
        <ShieldCheck className="size-4 text-success" /> Audit trail on
      </p>
      <p
        aria-hidden="true"
        className="float absolute -right-3 bottom-16 hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-text shadow-lg [animation-delay:-4s] lg:flex"
      >
        <CheckCircle2 className="size-4 text-success" /> Awaiting your approval
      </p>
    </div>
  );
}

const STAGES: Array<[string, LucideIcon]> = [
  ['Intake', Inbox],
  ['Plan', ClipboardList],
  ['Tender', FileText],
  ['Evaluate', Scale],
  ['Award', Award],
  ['Manage', FileSignature],
  ['Report', BarChart3],
];

export function LifecycleStrip() {
  return (
    <ol
      aria-label="The seven lifecycle stages"
      className="relative grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
    >
      {STAGES.map(([s, Icon], i) => (
        <li
          key={s}
          className="card-lift reveal-scroll relative flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-3 py-5 text-center text-sm font-semibold text-text shadow-sm"
        >
          <span className="icon-tile">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-xs font-bold text-text-muted">Step {i + 1}</span>
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
      className="relative overflow-hidden rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/10 to-transparent"
      />
      <div className="relative mx-auto flex w-fit items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold shadow-md">
        <Stamp className="size-4" aria-hidden="true" />
        One conversation
      </div>
      <div aria-hidden="true" className="relative mx-auto h-8 w-px bg-border-strong" />
      <ul className="relative grid gap-3 sm:grid-cols-5">
        {docs.map((d) => (
          <li
            key={d}
            className="card-lift flex flex-col items-center gap-2 rounded-md border border-border bg-surface-alt px-2 py-4 text-center text-xs font-semibold text-text"
          >
            <FileText className="size-6 text-accent" aria-hidden="true" />
            {d}
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </figure>
  );
}
