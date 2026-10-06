'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, Table, Td, Textarea, Th } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

interface Section {
  section: string;
  fields: Array<{ name: string; kind: string }>;
  isDefault: boolean;
  editor: { screen: string; panel: string };
  lastChangedBy: string | null;
  lastChangedAt: string | null;
}
interface Inventory {
  count: number;
  sections: Section[];
}
interface Change {
  section: string;
  fields: Array<{ field: string; before: unknown; after: unknown }>;
}
interface ImportResult {
  dryRun: boolean;
  valid: boolean;
  applied: boolean;
  errors: Array<{ field: string; message: string }>;
  changes: Change[];
  unchanged: number;
}
interface Baseline {
  total: number;
  supported: number;
  belowBaseline: number;
  byBrowser: Array<{ browser: string; supported: number; below: number }>;
  baseline: { reviewed: string; browsers: Array<{ family: string; min: number }> };
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : null;

/** Tenant configuration: what can be changed and where, export, import with a preview (NFR-M05), and the browser baseline summary (NFR-C08). */
export function ConfigAdmin({ csrf }: { csrf: string }) {
  const inv = useData<Inventory>('/admin/config/inventory');
  const base = useData<Baseline>('/admin/client-baseline');
  const { busy, run, messages } = useRun();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ result: ImportResult; text: string } | null>(null);

  async function chooseFile(f: File | undefined) {
    if (!f) return;
    setText(await f.text());
    setPreview(null);
  }
  function parsed(): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async function check() {
    const config = parsed();
    if (config === null) {
      setPreview({
        result: {
          dryRun: true,
          valid: false,
          applied: false,
          errors: [{ field: 'file', message: 'That is not valid JSON.' }],
          changes: [],
          unchanged: 0,
        },
        text,
      });
      return;
    }
    const result = await send<ImportResult>(csrf, 'POST', '/admin/config/import', { dryRun: true, config });
    setPreview({ result, text });
  }
  async function apply() {
    const config = parsed();
    const result = await send<ImportResult>(csrf, 'POST', '/admin/config/import', { dryRun: false, config });
    setPreview({ result, text });
    await inv.reload();
  }
  const fresh = preview !== null && preview.text === text;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="inv-h" className="flex flex-col gap-3">
        <h2 id="inv-h" className="font-heading text-xl font-bold">
          Every setting, and where to change it
        </h2>
        <p className="max-w-prose text-sm text-text-muted">
          All of an organisation&apos;s rules are settings that an administrator changes on screen. None needs
          a release. Each change is audited, and takes effect on the next request.
        </p>
        {inv.error && !inv.data && (
          <p role="alert" className="text-sm font-medium text-error">
            {inv.error}
          </p>
        )}
        {inv.data && (
          <Table caption={`${inv.data.count} configuration sections`}>
            <thead>
              <tr>
                <Th>Section</Th>
                <Th>Fields</Th>
                <Th>Edited on</Th>
                <Th>Value</Th>
                <Th>Last changed</Th>
              </tr>
            </thead>
            <tbody>
              {inv.data.sections.map((s) => (
                <tr key={s.section} data-testid="config-row" data-section={s.section}>
                  <Td label="Section">
                    <span className="font-mono text-sm">{s.section}</span>
                  </Td>
                  <Td label="Fields">
                    <details>
                      <summary className="cursor-pointer text-sm">{s.fields.length} fields</summary>
                      <ul className="mt-1 list-disc pl-5 text-xs text-text-muted">
                        {s.fields.map((f) => (
                          <li key={f.name}>
                            {f.name}: {f.kind}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </Td>
                  <Td label="Edited on">
                    <Link href={s.editor.screen}>{s.editor.panel}</Link>
                  </Td>
                  <Td label="Value">
                    <Badge tone={s.isDefault ? 'neutral' : 'info'}>
                      {s.isDefault ? 'Default' : 'Changed'}
                    </Badge>
                  </Td>
                  <Td label="Last changed">
                    {s.lastChangedAt
                      ? `${when(s.lastChangedAt)} by ${s.lastChangedBy ?? 'unknown'}`
                      : 'Not changed here'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="port-h" className="flex flex-col gap-3">
        <h2 id="port-h" className="font-heading text-xl font-bold">
          Export and import
        </h2>
        <Card className="flex flex-col gap-4">
          <div>
            <p className="max-w-prose text-sm text-text-muted">
              The export holds every setting as a JSON file. Secrets are left empty and no user data is
              included, so the file can be kept with change records or loaded into another environment.
            </p>
            <Button asChild className="mt-3 w-fit" variant="secondary">
              <a href="/api/v1/admin/config/export" download data-testid="config-export">
                Download configuration
              </a>
            </Button>
          </div>
          <div>
            <label htmlFor="config-file" className="block text-sm font-semibold">
              Configuration file
            </label>
            <input
              id="config-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => void chooseFile(e.target.files?.[0])}
              className="mt-1 block min-h-[44px] text-sm"
            />
            <label htmlFor="config-text" className="mt-3 block text-sm font-semibold">
              Or paste it here
            </label>
            <Textarea
              id="config-text"
              rows={6}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
              className="font-mono text-xs"
              spellCheck={false}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={busy === 'check'}
                disabled={!text.trim() || busy !== null}
                onClick={() => void run('check', check)}
              >
                Preview changes
              </Button>
              <Button
                loading={busy === 'apply'}
                disabled={
                  !fresh || !preview.result.valid || preview.result.changes.length === 0 || busy !== null
                }
                onClick={() => void run('apply', apply, 'Configuration applied. It is in effect now.')}
              >
                Apply changes
              </Button>
            </div>
            {messages}
          </div>
          {preview && (
            <div data-testid="import-preview" aria-live="polite">
              <h3 className="font-heading text-lg font-bold">
                {preview.result.applied ? 'Applied' : 'Preview, nothing applied yet'}
              </h3>
              {preview.result.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-error" role="alert">
                  {preview.result.errors.map((e) => (
                    <li key={e.field + e.message}>
                      {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {preview.result.valid && preview.result.changes.length === 0 && (
                <p className="mt-2 text-sm">No differences from the current configuration.</p>
              )}
              {preview.result.changes.map((c) => (
                <div key={c.section} className="mt-3">
                  <p className="font-mono text-sm font-semibold">{c.section}</p>
                  <ul className="list-disc pl-5 text-sm">
                    {c.fields.map((f) => (
                      <li key={f.field}>
                        {f.field}: <span className="text-text-muted">{show(f.before)}</span> to{' '}
                        <strong>{show(f.after)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {preview.result.unchanged > 0 && (
                <p className="mt-2 text-sm text-text-muted">
                  {preview.result.unchanged} section{preview.result.unchanged === 1 ? '' : 's'} in the file
                  match what is already set.
                </p>
              )}
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="bl-h" className="flex flex-col gap-3">
        <h2 id="bl-h" className="font-heading text-xl font-bold">
          Browsers signing in
        </h2>
        <p className="max-w-prose text-sm text-text-muted">
          Each browser reports itself once after sign-in and is judged against the{' '}
          <Link href="/browser-support" className="underline">
            published baseline
          </Link>
          . Only the browser, its version and whether it met the baseline are counted; nothing about the
          person is kept.
        </p>
        {base.data && (
          <Card data-testid="client-baseline">
            <p className="text-sm">
              <strong>{base.data.total}</strong> sign-ins counted: {base.data.supported} met the baseline,{' '}
              {base.data.belowBaseline} did not.
            </p>
            {base.data.byBrowser.length > 0 && (
              <Table caption="Sign-ins by browser">
                <thead>
                  <tr>
                    <Th>Browser</Th>
                    <Th className="text-right">Met the baseline</Th>
                    <Th className="text-right">Below baseline</Th>
                  </tr>
                </thead>
                <tbody>
                  {base.data.byBrowser.map((b) => (
                    <tr key={b.browser}>
                      <Td label="Browser">{b.browser}</Td>
                      <Td label="Met" className="text-right">
                        {b.supported}
                      </Td>
                      <Td label="Below" className="text-right">
                        {b.below}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}
