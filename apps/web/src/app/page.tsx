import { Bot, FileCheck2, Gauge, Layers, Link2, ShieldCheck, Smartphone, UserCheck } from 'lucide-react';
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
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 py-14">
      <div className="mx-auto max-w-6xl px-4">
        <h2 id={`${id}-h`} className="text-3xl font-bold">
          {title}
        </h2>
        {intro && <p className="mt-2 max-w-prose text-text-muted">{intro}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section aria-labelledby="hero-h" className="bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <p className="w-fit rounded-full border border-border bg-surface-alt px-3 py-1 text-sm font-semibold text-text-muted">
                The autonomous sourcing engine
              </p>
              <h1 id="hero-h" className="text-4xl font-extrabold leading-tight sm:text-5xl">
                From request to signed contract, in one conversation.
              </h1>
              <p className="max-w-prose text-lg text-text-muted">
                Cut re-keying, close compliance gaps and keep value from leaking after signature. Intuitive
                Fusion turns plain-language requests into governed, auditable procurement.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg" variant="accent">
                  <Link href="/login" className="text-accent-fg no-underline">
                    Get started
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href="#how-it-works" className="text-text no-underline">
                    See how it works
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <ConversationMock />
            </div>
          </div>
        </section>

        <Section
          id="lifecycle"
          title="One platform for the full lifecycle"
          intro="Seven connected stages share one record, so information entered once is reused everywhere."
        >
          <LifecycleStrip />
          <div className="mt-8">
            <DocumentFanout />
          </div>
        </Section>

        <div className="bg-surface-alt">
          <Section id="features" title="Key features and benefits">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((f) => (
                <li
                  key={f.title}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface p-5 text-text shadow-sm"
                >
                  <span className="text-accent">{f.icon}</span>
                  <h3 className="font-heading text-lg font-semibold">{f.title}</h3>
                  <p className="text-sm text-text-muted">{f.text}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="how-it-works" title="How it works">
          <ol className="grid gap-4 md:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-5">
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent font-bold text-accent-fg">
                  {s.n}
                </span>
                <h3 className="font-heading text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <div className="bg-surface-alt">
          <Section
            id="trust"
            title="Security, trust and compliance"
            intro="Controls are designed in from the start. Alignment is by design; independent certification and IRAP assessment have not been performed on this proof of concept."
          >
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {trust.map(([t, d]) => (
                <li key={t} className="rounded-md border border-border bg-surface p-5">
                  <h3 className="flex items-center gap-2 font-heading text-lg font-semibold">
                    <ShieldCheck className="size-5 text-success" aria-hidden="true" />
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

        <Section id="faq" title="Frequently asked questions">
          <div className="max-w-3xl">
            <Accordion items={faqs.map((f) => ({ q: f.q, a: <p>{f.a}</p> }))} />
          </div>
        </Section>

        <section aria-labelledby="cta-h" className="bg-primary text-primary-fg">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="cta-h" className="text-2xl font-bold">
              Ready to see the proof of concept?
            </h2>
            <Button asChild size="lg" variant="accent">
              <Link href="/login" className="text-accent-fg no-underline">
                Log in
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
