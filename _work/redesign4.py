p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\app\page.tsx'
t = open(p, encoding='utf8', newline='').read()

# ---- Section helper: eyebrow + centred, roomier
a = t.index("function Section({")
b = t.index("export default function Home()")
t = t[:a] + '''function Section({
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

''' + t[b:]

# ---- Hero
a = t.index('        <section aria-labelledby="hero-h" className="bg-surface">')
b = t.index('        <Section\n          id="lifecycle"')
hero = '''        <section aria-labelledby="hero-h" className="bg-hero-mesh relative overflow-hidden">
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
                From request to signed contract, <span className="text-brand-gradient">in one conversation.</span>
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
                {['Speak or type your request', 'AI drafts, people decide', 'Audit-ready by default'].map((x) => (
                  <li key={x} className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                    {x}
                  </li>
                ))}
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

'''
t = t[:a] + hero + t[b:]

t = t.replace("import { Bot, FileCheck2,", "import { ArrowRight, Bot, CheckCircle2, FileCheck2,")

# ---- Lifecycle section eyebrow
t = t.replace('''          id="lifecycle"
          title="One platform for the full lifecycle"''', '''          id="lifecycle"
          eyebrow="Platform"
          title="One platform for the full lifecycle"''')

# ---- Features bento
a = t.index('        <div className="bg-surface-alt">\n          <Section id="features"')
b = t.index('        <Section id="how-it-works"')
feat = '''        <div className="bg-surface-alt">
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
                  className={
                    i === 0
                      ? 'card-lift reveal-scroll flex flex-col gap-3 rounded-lg bg-brand-gradient p-6 shadow-md sm:col-span-2 lg:row-span-1'
                      : 'card-lift reveal-scroll flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 text-text shadow-sm'
                  }
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

'''
t = t[:a] + feat + t[b:]

# ---- Steps
a = t.index('        <Section id="how-it-works"')
b = t.index('        <div className="bg-surface-alt">\n          <Section\n            id="trust"')
steps = '''        <Section id="how-it-works" eyebrow="Process" title="How it works">
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

'''
t = t[:a] + steps + t[b:]

# ---- Trust
t = t.replace('''            id="trust"
            title="Security, trust and compliance"''', '''            id="trust"
            eyebrow="Trust"
            title="Security, trust and compliance"''')
t = t.replace('''                <li key={t} className="rounded-md border border-border bg-surface p-5">
                  <h3 className="flex items-center gap-2 font-heading text-lg font-semibold">
                    <ShieldCheck className="size-5 text-success" aria-hidden="true" />''', '''                <li key={t} className="card-lift rounded-lg border border-border bg-surface p-6 shadow-sm">
                  <h3 className="flex items-center gap-3 font-heading text-lg font-bold">
                    <span className="icon-tile !size-10 shrink-0">
                      <ShieldCheck className="size-5" aria-hidden="true" />
                    </span>''')

# ---- FAQ
t = t.replace('<Section id="faq" title="Frequently asked questions">', '<Section id="faq" eyebrow="FAQ" title="Frequently asked questions">')

# ---- CTA
a = t.index('        <section aria-labelledby="cta-h"')
b = t.index('      </main>')
cta = '''        <section aria-labelledby="cta-h" className="px-4 pb-20">
          <div className="bg-brand-gradient relative mx-auto flex max-w-6xl flex-col items-start gap-6 overflow-hidden rounded-lg px-8 py-12 shadow-lg sm:flex-row sm:items-center sm:justify-between sm:px-12">
            <span aria-hidden="true" className="absolute -right-10 -top-16 size-56 rounded-full bg-white/10" />
            <span aria-hidden="true" className="absolute -bottom-20 right-40 size-44 rounded-full bg-white/10" />
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
'''
t = t[:a] + cta + t[b:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
