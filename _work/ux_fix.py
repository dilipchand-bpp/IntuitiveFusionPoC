def rw(p, pairs):
    s = open(p, encoding='utf8', newline='').read()
    for old, new in pairs:
        assert old in s, (p, old[:70])
        s = s.replace(old, new, 1)
    open(p, 'w', encoding='utf8', newline='').write(s)


# ---------------------------------------------------------------- the schedule: a label column, month scale, legend
p = 'apps/web/src/components/reports/b6-reports.tsx'
s = open(p, encoding='utf8', newline='').read()
a = s.index("  return (\n    <div className=\"flex flex-col gap-6\" data-testid=\"schedule\">")
b = s.index("      {r.messages}\n\n      {data.canMove && (")
new = '''  const months: Array<{ label: string; at: number }> = [];
  for (let t = new Date(lo); t.getTime() < hi; ) {
    const first = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
    months.push({ label: new Date(first).toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' }), at: first });
    t = new Date(first);
  }
  const todayAt = pct(ms(data.today));
  return (
    <div className="flex flex-col gap-6" data-testid="schedule">
      <ul className="flex flex-wrap gap-3 text-xs" aria-label="Phases">
        {data.items[0]!.slots.map((s, k) => (
          <li key={s.phase} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded-sm ${PHASE_FILL[k % PHASE_FILL.length]}`} aria-hidden="true" />
            {PHASE_NAME[s.phase]}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-0.5 bg-error" aria-hidden="true" />
          Today ({data.today})
        </li>
      </ul>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface" role="group" aria-label="Procurement schedule">
        <div className="min-w-[56rem]">
          <div className="grid grid-cols-[15rem_1fr] border-b border-border bg-surface-alt text-xs font-semibold text-text-muted">
            <div className="px-3 py-2">Procurement</div>
            <div className="relative h-8">
              {months.filter((m) => pct(m.at) < 100).map((m) => (
                <span key={m.at} className="absolute top-2 -translate-x-0 border-l border-border pl-1" style={{ left: `${pct(m.at)}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div ref={box} className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-[15rem] right-0" aria-hidden="true">
              <div className="absolute inset-y-0 w-px bg-error" style={{ left: `${todayAt}%` }} />
            </div>
            <ul>
              {data.items.map((i) => (
                <li key={i.requestId} data-testid="schedule-row" className="grid grid-cols-[15rem_1fr] items-center border-b border-border last:border-b-0">
                  <div className="min-w-0 px-3 py-2">
                    <p className="truncate text-sm font-semibold" title={i.title}>{i.title}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
                      <span className="font-mono">{i.number}</span> · {PHASE_NAME[i.phase] ?? i.phase}
                      {i.late && <Badge tone="error">Behind</Badge>}
                    </p>
                  </div>
                  <div className="relative my-2 h-8" style={{ touchAction: 'none' }}>
                    {i.slots.map((s, k) => {
                      const dx = drag && drag.id === i.requestId && (drag.phase === s.phase || i.slots.findIndex((q) => q.phase === drag.phase) < k) ? drag.dx : 0;
                      return (
                        <div
                          key={s.phase}
                          role="img"
                          aria-label={`${PHASE_NAME[s.phase]}: ${s.startDate} to ${s.endDate}`}
                          title={`${PHASE_NAME[s.phase]} ${s.startDate} to ${s.endDate}${data.canMove ? ' (drag to move)' : ''}`}
                          className={`absolute top-0 flex h-8 items-center overflow-hidden rounded-sm border border-surface text-[10px] font-semibold text-white ${PHASE_FILL[k % PHASE_FILL.length]} ${data.canMove ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          style={{ left: `${pct(ms(s.startDate))}%`, width: `${Math.max(1, pct(ms(s.endDate)) - pct(ms(s.startDate)))}%`, transform: `translateX(${dx}px)` }}
                          onPointerDown={(e) => {
                            if (!data.canMove) return;
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            setDrag({ id: i.requestId, phase: s.phase, x: e.clientX, dx: 0 });
                          }}
                          onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x })}
                          onPointerUp={() => {
                            if (!drag) return;
                            const days = dragDays(drag.dx);
                            setDrag(null);
                            if (days !== 0) void move(drag.id, drag.phase, days);
                          }}
                        >
                          <span className="truncate px-1">{PHASE_NAME[s.phase]}</span>
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <p className="text-xs text-text-muted">{data.canMove ? 'Drag a bar to move that phase and everything after it.' : 'Read only: procurement moves phases.'}</p>
'''
s = s[:a] + new + s[b:]
# the drag width must be that of the timeline column, not the whole box
s = s.replace("    const w = box.current?.getBoundingClientRect().width ?? 1;", "    const w = (box.current?.getBoundingClientRect().width ?? 1) - 240;")
open(p, 'w', encoding='utf8', newline='').write(s)

# ---------------------------------------------------------------- search contracts
p = 'apps/web/src/app/app/contracts/mine/page.tsx'
s = open(p, encoding='utf8', newline='').read()
a = s.index("      <form role=\"search\"")
b = s.index("      {!res ? (")
chips = '''      <form role="search" aria-label="Search contracts" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-semibold">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Number, title or supplier"
            className="min-h-[44px] rounded-md border border-border-strong bg-surface px-3 text-base font-normal"
          />
        </label>
        {within && <input type="hidden" name="within" value={within} />}
        <button type="submit" className="min-h-[44px] rounded-md bg-brand-gradient px-5 text-sm font-semibold text-white">
          Search
        </button>
        <nav aria-label="Ending within" className="flex basis-full flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Ending within</span>
          {[['', 'Any time'], ...WINDOWS.map((w) => [String(w), `${w} days`])].map(([k, l]) => (
            <Link
              key={k}
              href={`/app/contracts/mine?${new URLSearchParams({ ...(q ? { q } : {}), ...(k ? { within: k } : {}) })}`}
              aria-current={(within ?? '') === k ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-semibold no-underline ${(within ?? '') === k ? 'border-accent bg-accent/10 text-accent' : 'border-border-strong text-text'}`}
            >
              {l}
            </Link>
          ))}
        </nav>
      </form>
      {res && <p className="text-sm text-text-muted">{res.items.length} contract(s).</p>}
'''
s = s[:a] + chips + s[b:]
s = s.replace("""                  <Link href={`/app/contracts/${c.id}`}>{c.title ?? c.number}</Link>
                  <div className="font-mono text-xs text-text-muted">{c.number}</div>""", """                  <Link href={`/app/contracts/${c.id}`}>{c.title ?? c.supplier}</Link>
                  <div className="font-mono text-xs text-text-muted">{c.number}</div>""")
s = s.replace("""                <Td label="Supplier">{c.supplier}</Td>
                <Td label="Owner">{c.owner ?? '–'}</Td>""", """                <Td label="Supplier">{c.supplier}</Td>
                <Td label="Owner">{c.owner ?? 'Not assigned'}</Td>""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
