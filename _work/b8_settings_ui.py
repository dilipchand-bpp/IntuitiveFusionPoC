p = 'apps/web/src/components/admin/settings-panel.tsx'
s = open(p, encoding='utf8', newline='').read().replace('\r\n', '\n')


def sub(a, b):
    global s
    assert a in s, a[:60]
    s = s.replace(a, b, 1)


sub("  dashboards: { visibility: 'HIERARCHY' | 'BROAD'; capacityPerManager: number; referenceRefreshDays: number };\n",
    """  dashboards: { visibility: 'HIERARCHY' | 'BROAD'; capacityPerManager: number; referenceRefreshDays: number };
  tenderRules: { dualWitnessThresholdAud: number; witnessWindowMinutes: number };
  ratings: { supplierSeesRatings: boolean; staffSeeSupplierRatings: boolean };
  legalPlatform: { enabled: boolean; name: string; webhookSecret: string; simulateOutage: boolean };
  approvalLinks: { enabled: boolean; validHours: number; showCommercial: boolean };
""")

block = """      <Section
        {...sec('tenderRules')}
        title="Opening high-value bids"
        blurb="A tender at or above this value stays sealed after it closes until two independent witnesses confirm. A single tender can also be marked this way when its pack is prepared."
        onSave={() => void save('tenderRules', s.tenderRules)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Needs two witnesses at or above (AUD)">
            <Input
              type="number"
              min={0}
              value={s.tenderRules.dualWitnessThresholdAud}
              onChange={(e) =>
                setS({ ...s, tenderRules: { ...s.tenderRules, dualWitnessThresholdAud: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Both witnesses within (minutes)">
            <Input
              type="number"
              min={1}
              max={240}
              value={s.tenderRules.witnessWindowMinutes}
              onChange={(e) =>
                setS({ ...s, tenderRules: { ...s.tenderRules, witnessWindowMinutes: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Section>

      <Section
        {...sec('ratings')}
        title="Supplier ratings"
        blurb="Who can see the ratings the enterprise and its suppliers give each other."
        onSave={() => void save('ratings', s.ratings)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.ratings.supplierSeesRatings}
            onChange={(e) => setS({ ...s, ratings: { ...s.ratings, supplierSeesRatings: e.target.checked } })}
          />
          <span>A supplier can see how the enterprise rated them</span>
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.ratings.staffSeeSupplierRatings}
            onChange={(e) => setS({ ...s, ratings: { ...s.ratings, staffSeeSupplierRatings: e.target.checked } })}
          />
          <span>The buying team can read what suppliers said about the enterprise</span>
        </label>
      </Section>

      <Section
        {...sec('approvalLinks')}
        title="Approve from a link"
        blurb="Approvers are sent a one-time link that lets them decide without signing in. The same limits and checks still apply."
        onSave={() => void save('approvalLinks', s.approvalLinks)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.approvalLinks.enabled}
            onChange={(e) => setS({ ...s, approvalLinks: { ...s.approvalLinks, enabled: e.target.checked } })}
          />
          <span>Send approvers a one-time link</span>
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.approvalLinks.showCommercial}
            onChange={(e) => setS({ ...s, approvalLinks: { ...s.approvalLinks, showCommercial: e.target.checked } })}
          />
          <span>Show the dollar value on the link page (off keeps commercial information back)</span>
        </label>
        <Field label="A link works for (hours)">
          <Input
            type="number"
            min={1}
            max={336}
            value={s.approvalLinks.validHours}
            onChange={(e) => setS({ ...s, approvalLinks: { ...s.approvalLinks, validHours: Number(e.target.value) } })}
            className="w-32"
          />
        </Field>
      </Section>

      <Section
        {...sec('legalPlatform')}
        title="Legal platform"
        blurb="If the organisation runs an enterprise legal platform, each new legal matter is raised there, and its stage and redlines come back to the contract. Here the platform is simulated."
        onSave={() => void save('legalPlatform', s.legalPlatform)}
      >
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.legalPlatform.enabled}
            onChange={(e) => setS({ ...s, legalPlatform: { ...s.legalPlatform, enabled: e.target.checked } })}
          />
          <span>We run a legal platform</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Its name">
            <Input
              value={s.legalPlatform.name}
              maxLength={60}
              onChange={(e) => setS({ ...s, legalPlatform: { ...s.legalPlatform, name: e.target.value } })}
            />
          </Field>
          <Field label="Shared secret that signs what it sends back" hint="Kept here for the demonstration; a production deployment holds it in a secret store.">
            <Input
              type="password"
              autoComplete="off"
              value={s.legalPlatform.webhookSecret}
              maxLength={200}
              onChange={(e) => setS({ ...s, legalPlatform: { ...s.legalPlatform, webhookSecret: e.target.value } })}
            />
          </Field>
        </div>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--if-color-accent)]"
            checked={s.legalPlatform.simulateOutage}
            onChange={(e) => setS({ ...s, legalPlatform: { ...s.legalPlatform, simulateOutage: e.target.checked } })}
          />
          <span>Pretend the platform is down (to show failed deliveries and the retry)</span>
        </label>
      </Section>

"""
sub("      <Section\n        {...sec('contractManagement')}", block + "      <Section\n        {...sec('contractManagement')}")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
