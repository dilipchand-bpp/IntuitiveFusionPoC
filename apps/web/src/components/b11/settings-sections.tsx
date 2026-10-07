'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Checkbox, Field, Input, Select } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

type Level = 'SES' | 'AES' | 'QES';
interface Signatures {
  defaultLevel: Level;
  requiredLevelByValue: Array<{ fromAud: number; level: Level }>;
}
interface ContentSettings {
  refreshDays: number;
  validDays: number;
  useOutsideContent: boolean;
}
interface EsgPlan {
  atRiskBandPct: number;
  maxRelaxationPct: number;
  limits: Record<string, number>;
}
interface Loaded {
  signatures: Signatures;
  content: ContentSettings;
  esgPlan: EsgPlan;
}

const LIMITS: Array<[string, string, string]> = [
  ['INDIGENOUS_SPEND_PCT', 'Indigenous-owned spend, at least (% of contract value)', '0 to 100'],
  ['SOCIAL_ENTERPRISE_SPEND_PCT', 'Social enterprise spend, at least (% of contract value)', '0 to 100'],
  [
    'DISABILITY_EMPLOYMENT_SPEND_PCT',
    'Disability employment spend, at least (% of contract value)',
    '0 to 100',
  ],
  ['LOCAL_CONTENT_PCT', 'Local content, at least (% of labour hours)', '0 to 100'],
  ['SUPPLIER_DIVERSITY_PCT', 'Supplier diversity, at least (% of contract value)', '0 to 100'],
  ['SME_PANEL_PCT', 'Small and medium suppliers, at least (% of the panel)', '0 to 100'],
  ['CARBON_INTENSITY_T_PER_M', 'Carbon intensity ceiling (tonnes CO2e per $m)', 'Zero or more'],
  ['MODERN_SLAVERY_RISK', 'Modern slavery risk rating ceiling', '1 Low, 2 Medium, 3 High'],
  ['SINGLE_SUPPLIER_SHARE_PCT', 'Largest single supplier share, at most (% of contract spend)', '0 to 100'],
];

function Block({
  id,
  title,
  blurb,
  children,
  onSave,
  busy,
  messages,
}: {
  id: string;
  title: string;
  blurb: string;
  children: ReactNode;
  onSave: () => void;
  busy: boolean;
  messages: ReactNode;
}) {
  return (
    <Card role="region" aria-labelledby={`${id}-h`} data-testid={`settings-${id}`}>
      <h2 id={`${id}-h`} className="font-heading text-xl font-bold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">{blurb}</p>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
      {messages}
      <div className="mt-4">
        <Button loading={busy} onClick={onSave} aria-label={`Save ${title.toLowerCase()}`}>
          Save
        </Button>
      </div>
    </Card>
  );
}

/** Signature levels, outside content and ESG limits: the settings for NFR-L03, NFR-R03 and NFR-R05, saved through the same endpoint (and audit) as the rest. */
export function B11dSettings({ csrf }: { csrf: string }) {
  const { data, reload } = useData<Loaded>('/admin/settings');
  const sig = useRun();
  const con = useRun();
  const esg = useRun();
  const [s, setS] = useState<Signatures | null>(null);
  const [c, setC] = useState<ContentSettings | null>(null);
  const [e, setE] = useState<EsgPlan | null>(null);
  useEffect(() => {
    if (data?.signatures) setS(data.signatures);
    if (data?.content) setC(data.content);
    if (data?.esgPlan) setE(data.esgPlan);
  }, [data]);
  if (!s || !c || !e) return null;
  const save = (r: ReturnType<typeof useRun>, name: string, value: unknown) =>
    r.run(
      name,
      async () => {
        await send(csrf, 'PUT', '/admin/settings', { [name]: value });
        await reload();
      },
      'Saved and recorded in the audit trail.',
    );
  return (
    <>
      <Block
        id="signatures"
        title="Signature levels (eIDAS)"
        blurb="The level a contract's signatures must reach: SES simple, AES advanced (password and authenticator code), QES qualified (through the qualified provider). A higher value tier overrides the default; Legal can set a level on one contract with a reason."
        busy={sig.busy === 'signatures'}
        messages={sig.messages}
        onSave={() => void save(sig, 'signatures', s)}
      >
        <Field label="Default level">
          <Select
            value={s.defaultLevel}
            onChange={(ev) => setS({ ...s, defaultLevel: ev.target.value as Level })}
          >
            <option value="SES">SES: simple</option>
            <option value="AES">AES: advanced</option>
            <option value="QES">QES: qualified</option>
          </Select>
        </Field>
        {s.requiredLevelByValue.map((t, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
            <Field label={`From contract value (AUD), tier ${i + 1}`}>
              <Input
                type="number"
                min={0}
                value={t.fromAud}
                onChange={(ev) =>
                  setS({
                    ...s,
                    requiredLevelByValue: s.requiredLevelByValue.map((x, j) =>
                      j === i ? { ...x, fromAud: Number(ev.target.value) } : x,
                    ),
                  })
                }
              />
            </Field>
            <Field label={`Level, tier ${i + 1}`}>
              <Select
                value={t.level}
                onChange={(ev) =>
                  setS({
                    ...s,
                    requiredLevelByValue: s.requiredLevelByValue.map((x, j) =>
                      j === i ? { ...x, level: ev.target.value as Level } : x,
                    ),
                  })
                }
              >
                <option value="SES">SES</option>
                <option value="AES">AES</option>
                <option value="QES">QES</option>
              </Select>
            </Field>
            <Button
              variant="ghost"
              aria-label={`Remove tier ${i + 1}`}
              onClick={() =>
                setS({ ...s, requiredLevelByValue: s.requiredLevelByValue.filter((_, j) => j !== i) })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            disabled={s.requiredLevelByValue.length >= 6}
            onClick={() =>
              setS({
                ...s,
                requiredLevelByValue: [...s.requiredLevelByValue, { fromAud: 100000, level: 'AES' }],
              })
            }
          >
            Add a value tier
          </Button>
        </div>
      </Block>

      <Block
        id="content"
        title="Outside content packs"
        blurb="How often the reference packs (classification codes, market prices, standard risks) refresh from the outside source, and how long one stays usable after a refresh. A pack past that is not used and fields say they are in-house only."
        busy={con.busy === 'content'}
        messages={con.messages}
        onSave={() => void save(con, 'content', c)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Refresh every (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={c.refreshDays}
              onChange={(ev) => setC({ ...c, refreshDays: Number(ev.target.value) })}
            />
          </Field>
          <Field label="Stays usable for (days)" hint="At least as long as the refresh interval.">
            <Input
              type="number"
              min={1}
              max={730}
              value={c.validDays}
              onChange={(ev) => setC({ ...c, validDays: Number(ev.target.value) })}
            />
          </Field>
        </div>
        <Checkbox
          label="Use outside content (off means in-house data only)"
          checked={c.useOutsideContent}
          onChange={(ev) => setC({ ...c, useOutsideContent: ev.target.checked })}
        />
      </Block>

      <Block
        id="esgPlan"
        title="ESG and socio-economic limits"
        blurb="The organisation's defaults for the targets and ceilings on every plan. A plan may be stricter freely, and looser only up to the relaxation below with a reason and an approver note."
        busy={esg.busy === 'esgPlan'}
        messages={esg.messages}
        onSave={() => void save(esg, 'esgPlan', e)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="At risk within (% of the limit)" hint="0 to 50">
            <Input
              type="number"
              min={0}
              max={50}
              value={e.atRiskBandPct}
              onChange={(ev) => setE({ ...e, atRiskBandPct: Number(ev.target.value) })}
            />
          </Field>
          <Field label="Most a plan may relax a limit (%)" hint="0 to 100">
            <Input
              type="number"
              min={0}
              max={100}
              value={e.maxRelaxationPct}
              onChange={(ev) => setE({ ...e, maxRelaxationPct: Number(ev.target.value) })}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LIMITS.map(([key, label, hint]) => (
            <Field key={key} label={label} hint={hint}>
              <Input
                type="number"
                min={0}
                step="any"
                value={e.limits[key] ?? 0}
                onChange={(ev) => setE({ ...e, limits: { ...e.limits, [key]: Number(ev.target.value) } })}
              />
            </Field>
          ))}
        </div>
      </Block>
    </>
  );
}
