def sub(p, pairs):
    t=open(p,encoding='utf8',newline='').read()
    for a,b in pairs:
        assert a in t, (p,a[:50])
        t=t.replace(a,b)
    open(p,'w',encoding='utf8',newline='').write(t)

base='packages/ui/src/components/'
sub(base+'button.tsx',[
("  accent: 'bg-accent text-accent-fg hover:bg-accent-hover',",
 "  accent:\n    'bg-brand-gradient shadow-md hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110 active:translate-y-0',"),
("  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',","  primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover',"),
("  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-alt',","  secondary: 'bg-surface text-text border border-border-strong shadow-sm hover:bg-surface-alt',"),
("'inline-flex items-center justify-center gap-2 rounded-sm font-semibold transition-colors',","'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-all duration-200',"),
])
sub(base+'brand.tsx',[('className="rounded-sm"','className="rounded-md shadow-sm"')])
sub(base+'display.tsx',[
("className={cn('rounded-md border border-border bg-surface p-6 text-text shadow-sm', className)}","className={cn('rounded-lg border border-border bg-surface p-6 text-text shadow-sm', className)}"),
('className="w-full overflow-x-auto rounded-md border border-border"','className="w-full overflow-x-auto rounded-lg border border-border bg-surface shadow-sm"'),
("<th scope=\"col\" className={cn('bg-surface-alt px-4 py-3 font-semibold text-text', className)} {...p} />","<th\n    scope=\"col\"\n    className={cn('bg-surface-alt px-4 py-3 text-xs font-bold uppercase tracking-wide text-text-muted', className)}\n    {...p}\n  />"),
("<td className={cn('border-t border-border px-4 py-3 text-text', className)} {...p} />","<td className={cn('border-t border-border px-4 py-3.5 text-text', className)} {...p} />"),
('className="inline-flex items-center gap-1 rounded-full border border-accent bg-surface px-2.5 py-0.5 text-xs font-semibold text-accent"','className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent"'),
('className="rounded-md border border-dashed border-border-strong bg-surface p-8 text-center"','className="rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center"'),
('<Clock className="mx-auto size-8 text-secondary" aria-hidden="true" />','<span className="icon-tile mx-auto">\n        <Clock className="size-6" aria-hidden="true" />\n      </span>'),
('className="flex flex-col items-center gap-2 rounded-md border border-border bg-surface p-8 text-center"','className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-10 text-center"'),
('<Inbox className="size-8 text-secondary" aria-hidden="true" />','<span className="icon-tile">\n        <Inbox className="size-6" aria-hidden="true" />\n      </span>'),
])
# table row hover: rows are plain <tr>; handle via arbitrary variant on table
sub(base+'display.tsx',[("<table className={cn('w-full border-collapse text-left text-sm', className)} {...p}>","<table\n        className={cn('w-full border-collapse text-left text-sm [&_tbody_tr:hover]:bg-surface-alt/60', className)}\n        {...p}\n      >")])
sub(base+'surfaces.tsx',[
('''    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-5 text-text shadow-sm">
      <div className="flex items-center justify-between text-sm font-semibold text-text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <p className="break-words font-heading text-2xl font-bold">{value}</p>''',
'''    <div className="card-lift relative flex flex-col gap-1 overflow-hidden rounded-lg border border-border bg-surface p-5 text-text shadow-sm">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
      <div className="flex items-center justify-between gap-2 text-sm font-semibold text-text-muted">
        <span>{label}</span>
        {icon && <span className="icon-tile !size-9 shrink-0">{icon}</span>}
      </div>
      <p className="mt-1 break-words font-heading text-3xl font-extrabold tracking-tight">{value}</p>'''),
])
