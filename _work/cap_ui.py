p = 'apps/web/src/components/reports/b6-reports.tsx'
s = open(p, encoding='utf8', newline='').read()
a = s.index("export function CapacityView")
b = s.index("// ------------------------------------------------------------------ spend by any dimension (FR-0645)")
new = '''export function CapacityView({ csrf, canAssign }: { csrf: string; canAssign: boolean }) {
  const { data, error, reload } = useData<Capacity>('/reports/capacity');
  const [pick, setPick] = useState<Record<string, string>>({});
  const [all, setAll] = useState('');
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const assign = (id: string, managerId: string | null) =>
    r.run(
      `a-${id}`,
      async () => {
        await send(csrf, 'PUT', `/requests/${id}/manager`, { managerId });
        await reload();
      },
      'Assigned.',
    );
  const assignAll = (managerId: string) =>
    r.run(
      'all',
      async () => {
        for (const i of data.unassigned) await send(csrf, 'PUT', `/requests/${i.id}/manager`, { managerId });
        setAll('');
        await reload();
      },
      'All assigned.',
    );
  const active = data.managers.reduce((n, m) => n + m.procurements, 0);
  const picker = (id: string, options: Capacity['managers'], label: string) => (
    <div className="flex items-center gap-2">
      <Select
        aria-label={label}
        value={pick[id] ?? ''}
        onChange={(e) => setPick({ ...pick, [id]: e.target.value })}
        className="!w-48"
      >
        <option value="">Choose manager…</option>
        {options.map((x) => (
          <option key={x.managerId} value={x.managerId}>
            {x.name}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        aria-label={label.replace(/ to$/, '')}
        disabled={!pick[id]}
        loading={r.busy === `a-${id}`}
        onClick={() => void assign(id, pick[id]!)}
      >
        Assign
      </Button>
    </div>
  );
  return (
    <div className="flex flex-col gap-6" data-testid="capacity">
      {data.suggestion && (
        <p role="status" className="rounded-md border border-warning bg-warning-bg p-3 text-sm font-semibold text-warning">
          {data.suggestion}
        </p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Managers', data.managers.length],
          ['Active procurements', active],
          ['Not yet assigned', data.unassigned.length],
          ['Capacity each', data.capacityPerManager],
        ].map(([k, v]) => (
          <Card key={k as string}>
            <dt className="text-sm text-text-muted">{k}</dt>
            <dd className="mt-1 text-2xl font-extrabold">{v}</dd>
          </Card>
        ))}
      </dl>

      <section aria-labelledby="mgrs-h" className="flex flex-col gap-3">
        <h2 id="mgrs-h" className="font-heading text-xl font-bold">
          Managers
        </h2>
        <ul className="grid gap-4 lg:grid-cols-2">
          {data.managers.map((m) => (
            <li key={m.managerId}>
              <Card data-testid={`manager-${m.name}`} className="h-full">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-heading text-lg font-bold">{m.name}</h3>
                  {m.overloaded && <Badge tone="error">Over capacity</Badge>}
                  <span className="ml-auto text-sm text-text-muted">{aud.format(m.exposure)} exposure</span>
                </div>
                <div className="mt-2">
                  <Bar label={`${m.procurements} of ${data.capacityPerManager} procurements`} pct={m.utilisation} />
                </div>
                {m.items.length === 0 ? (
                  <p className="mt-3 text-sm text-text-muted">Nothing assigned yet.</p>
                ) : (
                  <Table caption={`Work assigned to ${m.name}`} className="mt-3">
                    <thead>
                      <tr>
                        <Th>Procurement</Th>
                        <Th className="text-right">Value</Th>
                        {canAssign && <Th>Move to</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {m.items.map((i) => (
                        <tr key={i.id}>
                          <Td label="Procurement">
                            <span className="font-mono text-xs text-text-muted">{i.number}</span> {i.title}
                          </Td>
                          <Td label="Value" className="text-right">
                            {aud.format(i.value)}
                          </Td>
                          {canAssign && (
                            <Td label="Move to">
                              {picker(i.id, data.managers.filter((x) => x.managerId !== m.managerId), `Move ${i.number} to`)}
                            </Td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {data.unassigned.length > 0 && (
        <section aria-labelledby="un-h" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="un-h" className="font-heading text-xl font-bold">
              Not yet assigned to a manager ({data.unassigned.length})
            </h2>
            {canAssign && (
              <div className="ml-auto flex items-center gap-2">
                <Select aria-label="Assign all to" value={all} onChange={(e) => setAll(e.target.value)} className="!w-48">
                  <option value="">Assign all to…</option>
                  {data.managers.map((x) => (
                    <option key={x.managerId} value={x.managerId}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" disabled={!all} loading={r.busy === 'all'} onClick={() => void assignAll(all)}>
                  Assign all
                </Button>
              </div>
            )}
          </div>
          <Table caption="Procurements without a manager">
            <thead>
              <tr>
                <Th>Procurement</Th>
                <Th className="text-right">Value</Th>
                {canAssign && <Th>Assign to</Th>}
              </tr>
            </thead>
            <tbody>
              {data.unassigned.map((i) => (
                <tr key={i.id}>
                  <Td label="Procurement">
                    <span className="font-mono text-xs text-text-muted">{i.number}</span> {i.title}
                  </Td>
                  <Td label="Value" className="text-right">
                    {aud.format(i.value)}
                  </Td>
                  {canAssign && <Td label="Assign to">{picker(i.id, data.managers, `Assign ${i.number} to`)}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
      {r.messages}
    </div>
  );
}

'''
s = s[:a] + new + s[b:]
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
