def sub(p, a, b):
    t = open(p, encoding='utf8', newline='').read()
    assert a in t, (p, a[:70])
    open(p, 'w', encoding='utf8', newline='').write(t.replace(a, b, 1))


W = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\components\supplier\supplier-tender.tsx'
sub(W, 'sm:grid-cols-[12rem_1fr]', 'sm:grid-cols-[17rem_1fr]')
sub(W, 'className="min-h-[44px] w-full text-sm"',
    'className="min-h-[44px] w-full text-sm file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-md file:border-0 file:bg-accent/10 file:px-4 file:font-semibold file:text-accent hover:file:bg-accent/20"')

S = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\db\seed.ts'
sub(S, "        organisation: 'Meridian Group (demo)',\n        plan: {},",
    """        organisation: 'Meridian Group (demo)',
        plan: DEMO_PLAN_TEXT[requestKey] ?? {},""")
sub(S, "export const TENANT_ID = uid('tenant:meridian');",
    """export const TENANT_ID = uid('tenant:meridian');

/** Plain-language requirements the demo tender packs are built from (the seeded requests have no plan of their own). */
const DEMO_PLAN_TEXT: Record<string, Record<string, string>> = {
  cleaning: {
    objectives: 'Secure building cleaning that meets the requirements below at best value for money over the full term.',
    requirements:
      'Cleaning of all nominated sites to the agreed schedule and standard, including washrooms, kitchens and common areas.\\n\\nCompliance with work health and safety obligations, including induction, equipment and chemical safety.\\n\\nUse of environmentally responsible products and waste practices.',
    deliverables:
      'Delivery of building cleaning to agreed service levels, with monthly performance reporting.\\n\\nTransition-in plan and a named account manager.',
  },
  itmsp: {
    objectives: 'Engage a managed IT service provider to run the service desk, end-user devices and infrastructure monitoring.',
    requirements:
      'A 24x7 monitored service with a 15-minute response target for critical incidents.\\n\\nSecurity controls aligned to the ACSC Essential Eight, with evidence on request.\\n\\nData held and supported in Australia.',
    deliverables:
      'Service desk and incident management with a monthly service report.\\n\\nQuarterly service review and a continuous-improvement plan.\\n\\nTransition-in from the current provider over 90 days.',
  },
};""")
print('ok')
