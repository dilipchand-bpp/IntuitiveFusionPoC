import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileCheck2,
  Gauge,
  Layers,
  Link2,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Accordion, Button } from '@if/ui';
import { ConversationMock, DocumentFanout, LifecycleStrip } from '@/components/landing/illustrations';
import { SiteFooter, SiteHeader } from '@/components/landing/site-chrome';

export const metadata = {
  title: 'Intuitive Fusion – The autonomous sourcing engine',
  description:
    'Conversational, AI-driven procurement and contract management, from request intake to signed contract.',
};

const features: Array<{ icon: ReactNode; title: string; text: string }> = [
  {
    icon: <Bot className="size-6" aria-hidden="true" />,
    title: 'One conversation, every document',
    text: 'Describe what you need once. The assistant pre-populates the plan, tender pack, scoring sheet, evaluation report and contract, and asks only for what it cannot infer.',
  },
  {
    icon: <UserCheck className="size-6" aria-hidden="true" />,
    title: 'People stay in control',
    text: 'Every AI-drafted field is editable and clearly marked. Nothing progresses without a human approval.',
  },
  {
    icon: <ShieldCheck className="size-6" aria-hidden="true" />,
    title: 'Governance built in',
    text: 'Delegations of authority, conflict-of-interest gates and separate signing authority are enforced by the system, not by memory.',
  },
  {
    icon: <Layers className="size-6" aria-hidden="true" />,
    title: 'Sourcing joined to contracting',
    text: 'Supplier responses, pricing and SLAs flow straight into the contract. No copy-and-paste between systems.',
  },
  {
    icon: <Gauge className="size-6" aria-hidden="true" />,
    title: 'Value after signature',
    text: 'Obligations, milestones, notice periods and renewals become alerts automatically, so nothing slips.',
  },
  {
    icon: <Smartphone className="size-6" aria-hidden="true" />,
    title: 'Works on every screen',
    text: 'Review, comment and approve from a phone, tablet or desktop.',
  },
  {
    icon: <Link2 className="size-6" aria-hidden="true" />,
    title: 'Fits your landscape',
    text: 'Designed to connect to finance (ERP), legal matter management and e-signature providers through adapters.',
  },
  {
    icon: <FileCheck2 className="size-6" aria-hidden="true" />,
    title: 'Audit-ready by default',
    text: 'A tamper-evident record of who did what and when, exportable for auditors and probity advisors.',
  },
];

const steps = [
  {
    n: 1,
    title: 'Describe your need',
    text: 'Type or speak it in plain language. The assistant drafts the request and asks follow-up questions.',
  },
  {
    n: 2,
    title: 'Review the draft',
    text: 'Check the plan and tender pack. Change any field, or any paragraph, by telling the assistant.',
  },
  {
    n: 3,
    title: 'Approve with confidence',
    text: 'Delegates see a one-screen summary and approve within their limit, on any device.',
  },
  {
    n: 4,
    title: 'Award and manage',
    text: 'Evaluate fairly, draft and sign the contract, then track obligations and renewals.',
  },
];

const trust = [
  [
    'Tamper-evident audit trail',
    'Every action is recorded with who, what, when and the before/after values, chained so alteration is detectable.',
  ],
  [
    'Least-privilege access',
    'Role-based and attribute-based access, separation of duties, and no administrator access to bid content.',
  ],
  [
    'Probity by design',
    'Conflict declarations before access, hidden independent scoring, and consensus flags for large disagreements.',
  ],
  [
    'Data stays in Australia',
    'Designed for Australian hosting regions with encryption in transit and at rest.',
  ],
  ['AI proposes, people decide', 'Assistant output is logged, reviewable and never auto-committed.'],
];

const faqs = [
  {
    q: 'What is Intuitive Fusion?',
    a: 'A procurement and contract management platform built around one conversational front door, covering request intake, planning, tendering, evaluation, contract award, contract management and reporting.',
  },
  {
    q: 'Does the AI make decisions?',
    a: 'No. The assistant drafts and summarises. Every AI-populated field can be edited, is labelled, and requires human approval before the process moves on.',
  },
  {
    q: 'Is this a production system?',
    a: 'No. This is a proof of concept running on synthetic data. The AI, sign-in and integrations are simulated behind clearly defined swap points.',
  },
  {
    q: 'Where would data be stored?',
    a: 'The design targets Australian cloud regions. The proof of concept stores nothing outside your machine.',
  },
  {
    q: 'Which standards does it align to?',
    a: 'The design maps to ISO/IEC 27001 Annex A, the ACSC Essential Eight and the Australian Privacy Principles. This is alignment by design; no independent certification or IRAP assessment has been performed.',
  },
  {
    q: 'Can it integrate with our ERP and legal systems?',
    a: 'Yes by design: budget checks, matter management and e-signature are adapters. They are mocked in this proof of concept.',
  },
];

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="max-w-2xl">
          {eyebrow && (
            <p className="mb-2 text-sm font-bold uppercase tracking-widest text-accent">{eyebrow}</p>
          )}
          <h2 id={`${id}-h`} className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {title}
          </h2>
          {intro && <p className="mt-3 text-lg text-text-muted">{intro}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

const stats = [
  ['7', 'connected lifecycle stages'],
  ['1', 'shared record, entered once'],
  ['100%', 'of actions in the audit trail'],
  ['Every gate', 'needs a human decision'],
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section aria-labelledby="hero-h" className="bg-hero-mesh relative overflow-hidden">
          <div aria-hidden="true" className="bg-grid absolute inset-0" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pt-24">
            <div className="flex flex-col gap-7">
              <p className="reveal flex w-fit items-center gap-2 rounded-full border border-border bg-surface/80 px-3.5 py-1.5 text-sm font-semibold text-text shadow-sm">
                <span aria-hidden="true" className="pulse-dot size-2 rounded-full bg-success" />
                The autonomous sourcing engine
              </p>
              <h1
                id="hero-h"
                className="reveal text-5xl font-extrabold leading-[1.05] tracking-tight [--d:80ms] sm:text-6xl"
              >
                From request to signed contract,{' '}
                <span className="text-brand-gradient">in one conversation.</span>
              </h1>
              <p className="reveal max-w-prose text-lg text-text-muted [--d:160ms]">
                Cut re-keying, close compliance gaps and keep value from leaking after signature. Intuitive
                Fusion turns plain-language requests into governed, auditable procurement.
              </p>
              <div className="reveal flex flex-wrap gap-3 [--d:240ms]">
                <Button asChild size="lg" variant="accent">
                  <Link href="/login" className="text-gradient-fg no-underline">
                    Get started
                    <ArrowRight className="size-5" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href="#how-it-works" className="text-text no-underline">
                    See how it works
                  </a>
                </Button>
              </div>
              <ul className="reveal flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-text-muted [--d:320ms]">
                {['Speak or type your request', 'AI drafts, people decide', 'Audit-ready by default'].map(
                  (x) => (
                    <li key={x} className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                      {x}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <div className="reveal flex justify-center [--d:200ms] lg:justify-end">
              <ConversationMock />
            </div>
          </div>
        </section>

        <section aria-label="At a glance" className="border-y border-border bg-surface">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-4 py-8 lg:grid-cols-4">
            {stats.map(([n, l]) => (
              <div key={l} className="flex flex-col items-center gap-1 text-center">
                <dt className="font-heading text-3xl font-extrabold text-brand-gradient">{n}</dt>
                <dd className="text-sm text-text-muted">{l}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Section
          id="lifecycle"
          eyebrow="Platform"
          title="One platform for the full lifecycle"
          intro="Seven connected stages share one record, so information entered once is reused everywhere."
        >
          <LifecycleStrip />
          <div className="mt-8">
            <DocumentFanout />
          </div>
        </Section>

        <div className="bg-surface-alt">
          <Section
            id="features"
            eyebrow="Features"
            title="Key features and benefits"
            intro="Everything a procurement team needs, with the controls an auditor expects."
          >
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((f, i) => (
                <li
                  key={f.title}
                  className={`card-lift reveal-scroll flex flex-col gap-3 rounded-lg p-6 shadow-sm ${
                    i === 0 ? 'bg-brand-gradient shadow-md' : 'border border-border bg-surface text-text'
                  } ${[0, 3, 6, 7].includes(i) ? 'sm:col-span-2' : ''}`}
                >
                  <span
                    className={
                      i === 0
                        ? 'inline-flex size-11 items-center justify-center rounded-md bg-white/20'
                        : 'icon-tile'
                    }
                  >
                    {f.icon}
                  </span>
                  <h3 className="font-heading text-lg font-bold">{f.title}</h3>
                  <p className={i === 0 ? 'text-sm opacity-95' : 'text-sm text-text-muted'}>{f.text}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="how-it-works" eyebrow="Process" title="How it works">
          <ol className="relative grid gap-5 md:grid-cols-4">
            <span
              aria-hidden="true"
              className="absolute left-[12%] right-[12%] top-[2.1rem] hidden h-0.5 bg-gradient-to-r from-accent/60 to-gradient-to/60 md:block"
            />
            {steps.map((s) => (
              <li
                key={s.n}
                className="card-lift reveal-scroll relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 shadow-sm"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-gradient font-extrabold shadow-md">
                  {s.n}
                </span>
                <h3 className="font-heading text-lg font-bold">{s.title}</h3>
                <p className="text-sm text-text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <div className="bg-surface-alt">
          <Section
            id="trust"
            eyebrow="Trust"
            title="Security, trust and compliance"
            intro="Controls are designed in from the start. Alignment is by design; independent certification and IRAP assessment have not been performed on this proof of concept."
          >
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
              {trust.map(([t, d], i) => (
                <li
                  key={t}
                  className={`card-lift rounded-lg border border-border bg-surface p-6 shadow-sm ${i < 3 ? 'lg:col-span-2' : 'lg:col-span-3'} ${i === 4 ? 'sm:col-span-2' : ''}`}
                >
                  <h3 className="flex items-center gap-3 font-heading text-lg font-bold">
                    <span className="icon-tile !size-10 shrink-0">
                      <ShieldCheck className="size-5" aria-hidden="true" />
                    </span>
                    {t}
                  </h3>
                  <p className="mt-1 text-sm text-text-muted">{d}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-text-muted">
              Designed to align with: ISO/IEC 27001:2022 Annex A · ACSC Essential Eight · Australian Privacy
              Principles · WCAG 2.1 AA.
            </p>
          </Section>
        </div>

        <Section id="faq" eyebrow="FAQ" title="Frequently asked questions">
          <div className="max-w-3xl">
            <Accordion items={faqs.map((f) => ({ q: f.q, a: <p>{f.a}</p> }))} />
          </div>
        </Section>

        <section aria-labelledby="cta-h" className="px-4 pb-20">
          <div className="bg-brand-gradient relative mx-auto flex max-w-6xl flex-col items-start gap-6 overflow-hidden rounded-lg px-8 py-12 shadow-lg sm:flex-row sm:items-center sm:justify-between sm:px-12">
            <span
              aria-hidden="true"
              className="absolute -right-10 -top-16 size-56 rounded-full bg-white/10"
            />
            <span
              aria-hidden="true"
              className="absolute -bottom-20 right-40 size-44 rounded-full bg-white/10"
            />
            <div className="relative">
              <h2 id="cta-h" className="text-3xl font-extrabold tracking-tight">
                Ready to see the proof of concept?
              </h2>
              <p className="mt-1 opacity-90">Sign in with a demo account and follow a request end to end.</p>
            </div>
            <Button asChild size="lg" variant="secondary" className="relative">
              <Link href="/login" className="text-text no-underline">
                Log in
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
