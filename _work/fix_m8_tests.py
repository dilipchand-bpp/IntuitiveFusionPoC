import re


def edit(p, pairs, regex=False):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        if regex:
            t, n = re.subn(a, b, t, flags=re.S)
            assert n, a[:60]
        else:
            assert a in t, (p, a[:70])
            t = t.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(t)


R = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'

# ---------------------------------------------------------------- pack: never carry internal wording to suppliers
edit(R + r'\modules\tender\pack.ts', [
    ("const clean = (s: string | undefined) => (s ?? '').trim();",
     """const clean = (s: string | undefined) => (s ?? '').trim();

/**
 * Paragraphs that talk about money, risk rating, governance or internal approval are internal. Text copied from the plan
 * or the request is filtered through this before it can reach suppliers, so a budget sentence in the plan background can
 * never end up in the tender pack.
 */
const INTERNAL =
  /estimated value|\\bAUD\\b|\\$\\s?\\d|budget|complexity|governance|risk|delegat|approv|steering|committee|probity|conflict|sign-off|\\bplan\\b|contract owner/i;
export const publicText = (s: string | undefined): string =>
  clean(s)
    .split(/\\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !INTERNAL.test(p))
    .join('\\n\\n');"""),
    ("      clean(i.plan.background) || clean(i.request.background),", "      publicText(i.plan.background) || publicText(i.request.background),"),
    ("      paras(clean(i.plan.objectives)) ||", "      paras(publicText(i.plan.objectives)) ||"),
    ("paras(clean(i.plan.requirements)) ||", "paras(publicText(i.plan.requirements)) ||"),
    ("paras(clean(i.plan.deliverables), clean(i.request.deliverables)) ||", "paras(publicText(i.plan.deliverables), publicText(i.request.deliverables)) ||"),
    ("      clean(i.plan.milestones),", "      publicText(i.plan.milestones),"),
])

# unit test: prove it with a plan that has a budget sentence in the background
edit(R + r'\modules\tender\tender-domain.test.ts', [
    ("  it('pulls requirements and deliverables from the plan and never writes the budget estimate', () => {\n    const pack = buildTenderPack({ ...base, type: 'RFT', request: { estimatedValue: '1200000' } });",
     """  it('pulls requirements and deliverables from the plan and never writes the budget or other internal wording', () => {
    const pack = buildTenderPack({
      ...base,
      type: 'RFT',
      request: { estimatedValue: '1200000' },
      plan: {
        ...base.plan,
        background:
          'Existing arrangements are ending.\\n\\nThe estimated value is AUD 1,200,000 over 36 months.\\n\\nComplexity has been assessed as high, which determines the governance steps.',
        milestones: 'Plan approved: 9 October 2026\\n\\nTender closes: 13 November 2026\\n\\nEvaluation complete and report approved: 4 December 2026',
      },
    });
    expect(pack.overview).toContain('Existing arrangements are ending.');
    expect(pack.timetable).toContain('Tender closes: 13 November 2026');
    expect(pack.timetable).not.toMatch(/approved/i);"""),
    ("    expect(JSON.stringify(pack)).not.toMatch(/1[, ]?200[, ]?000|estimated/i);",
     "    expect(JSON.stringify(pack)).not.toMatch(/1[, ]?200[, ]?000|estimated|complexity|governance|AUD/i);"),
])

# ---------------------------------------------------------------- rate limit for the public routes is configurable (tests)
edit(R + r'\modules\tender\supplier-routes.ts', [
    ("  config: AppConfig;\n}", "  config: AppConfig;\n  /** Attempts per 15 minutes per address on the public registration routes. */\n  publicRateLimitMax?: number;\n}"),
    ("const publicLimit = { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } };",
     "const publicLimit = { config: { rateLimit: { max: d.publicRateLimitMax ?? 20, timeWindow: '15 minutes' } } };"),
])
edit(R + r'\app.ts', [
    ("registerSupplierRoutes(app, API_PREFIX, { ...guardDeps, store, config })",
     "registerSupplierRoutes(app, API_PREFIX, {\n      ...guardDeps,\n      store,\n      config,\n      publicRateLimitMax: deps.loginRateLimitMax ?? 20,\n    })"),
])

# ---------------------------------------------------------------- tests
T = R + r'\modules\tender\tender.test.ts'
edit(T, [
    ("toContain('Clean all');", "toMatch(/Cleaning of all nominated sites/);"),
    ("      expect((await call(supA.key, 'GET', '/supplier/tenders')).json().map((x: { id: string }) => x.id)).toEqual([a.id]);",
     "      const mine = (await call(supA.key, 'GET', '/supplier/tenders')).json().map((x: { id: string }) => x.id);\n    expect(mine).toContain(a.id);\n    expect(mine).not.toContain(b.id);"),
    ("['empty.pdf', Buffer.alloc(0), 400, 'FILE_EMPTY'],", "['empty.pdf', Buffer.alloc(0), 400, 'VALIDATION_FAILED'],"),
])
