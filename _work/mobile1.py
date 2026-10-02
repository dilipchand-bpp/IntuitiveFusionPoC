import re


def sub(p, pairs):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        assert a in t, (p, a[:70])
        t = t.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(t)


# ---- Table: cards on phones
TABLE_OLD = "          'w-full border-collapse text-left text-sm [&_tbody_tr:hover]:bg-surface-alt/60',\n          className,"
TABLE_NEW = (
    "          'w-full border-collapse text-left text-sm [&_tbody_tr:hover]:bg-surface-alt/60',\n"
    "          // Phones: each row becomes a labelled card (no sideways scrolling). Cells need a `label`.\n"
    "          'max-md:block max-md:[&_tbody]:block max-md:[&_thead]:sr-only max-md:[&_tbody_tr]:block max-md:[&_tbody_tr]:border-t max-md:[&_tbody_tr]:border-border max-md:[&_tbody_tr]:px-1 max-md:[&_tbody_tr]:py-2 max-md:[&_tbody_tr:first-child]:border-t-0',\n"
    "          className,"
)
TD_OLD = (
    "export const Td = ({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) => (\n"
    "  <td className={cn('border-t border-border px-4 py-3.5 text-text', className)} {...p} />\n"
    ");"
)
TD_NEW = """export const Td = ({
  className,
  label,
  ...p
}: HTMLAttributes<HTMLTableCellElement> & { label?: string }) => (
  <td
    data-label={label}
    className={cn(
      'border-t border-border px-4 py-3.5 text-text',
      'max-md:flex max-md:items-start max-md:justify-between max-md:gap-4 max-md:border-t-0 max-md:px-3 max-md:py-1.5 max-md:text-right',
      'max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-bold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-text-muted max-md:before:content-[attr(data-label)]',
      className,
    )}
    {...p}
  />
);"""
sub('packages/ui/src/components/display.tsx', [(TABLE_OLD, TABLE_NEW), (TD_OLD, TD_NEW)])

W = 'apps/web/src/app/app/'


def label_plain_tds(t, labels):
    tds = list(re.finditer(r'<Td>\n', t))
    assert len(tds) == len(labels), (len(tds), labels)
    for m, l in reversed(list(zip(tds, labels))):
        t = t[: m.start()] + '<Td label="%s">\n' % l + t[m.end():]
    return t


# requests
t = open(W + 'requests/page.tsx', encoding='utf8', newline='').read()
t = t.replace('<Td className="font-mono text-xs">{r.number}</Td>', '<Td label="Number" className="font-mono text-xs">{r.number}</Td>')
t = t.replace('<Td>{PHASE_LABEL[r.phase] ?? r.phase}</Td>', '<Td label="Phase">{PHASE_LABEL[r.phase] ?? r.phase}</Td>')
t = t.replace('<Td className="text-right">{aud.format(r.estimatedValue)}</Td>', '<Td label="Value" className="text-right">{aud.format(r.estimatedValue)}</Td>')
t = t.replace('<Td className="whitespace-nowrap">{when.format(new Date(r.updatedAt))}</Td>', '<Td label="Updated" className="whitespace-nowrap md:max-lg:hidden">{when.format(new Date(r.updatedAt))}</Td>')
t = t.replace('<Th>Updated</Th>', '<Th className="md:max-lg:hidden">Updated</Th>')
t = label_plain_tds(t, ['Title', 'Status', 'Complexity'])
open(W + 'requests/page.tsx', 'w', encoding='utf8', newline='').write(t)

# plans
t = open(W + 'plans/page.tsx', encoding='utf8', newline='').read()
t = t.replace('<Td className="font-mono text-xs">{r.requestNumber}</Td>', '<Td label="Request" className="font-mono text-xs">{r.requestNumber}</Td>')
t = t.replace('<Td className="text-right">{aud.format(r.estimatedValue)}</Td>', '<Td label="Value" className="text-right">{aud.format(r.estimatedValue)}</Td>')
t = t.replace('<Td className="whitespace-nowrap">{when.format(new Date(r.updatedAt))}</Td>', '<Td label="Updated" className="whitespace-nowrap">{when.format(new Date(r.updatedAt))}</Td>')
t = label_plain_tds(t, ['Title', 'Plan status', 'Complexity'])
open(W + 'plans/page.tsx', 'w', encoding='utf8', newline='').write(t)

# dashboard
t = open(W + 'dashboard/page.tsx', encoding='utf8', newline='').read()
t = t.replace('<Td className="font-mono text-xs">{r.number}</Td>', '<Td label="Number" className="font-mono text-xs">{r.number}</Td>')
t = t.replace('<Td>{r.title}</Td>', '<Td label="Title">{r.title}</Td>')
t = t.replace('<Td>{PHASE_LABEL[r.phase] ?? r.phase}</Td>', '<Td label="Phase">{PHASE_LABEL[r.phase] ?? r.phase}</Td>')
t = t.replace('<Td>\n                      <Badge tone={STATUS_TONE', '<Td label="Status">\n                      <Badge tone={STATUS_TONE')
t = t.replace('<Td className="text-right">{aud.format(r.estimatedValue)}</Td>', '<Td label="Value" className="text-right">{aud.format(r.estimatedValue)}</Td>')
t = t.replace(
    'className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"',
    'className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>:last-child:nth-child(odd)]:col-span-2 xl:[&>:last-child:nth-child(odd)]:col-span-1"',
)
open(W + 'dashboard/page.tsx', 'w', encoding='utf8', newline='').write(t)

# header chip only on xl; taller chat box; approvals card stacks on phones
sub('apps/web/src/components/shell/shell-frame.tsx', [('text-accent sm:inline', 'text-accent xl:inline')])
sub('apps/web/src/components/requests/intake-chat.tsx', [('rows={2}', 'rows={3}')])
sub(W + 'approvals/page.tsx', [(
    'className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-4"',
    'className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center"',
)])
print('ok')
