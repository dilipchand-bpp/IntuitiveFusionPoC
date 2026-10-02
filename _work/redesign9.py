p='apps/web/src/components/shell/command-palette.tsx'
t=open(p,encoding='utf8',newline='').read()
a=t.index('      <Button\n        variant="secondary"')
b=t.index('      <Dialog')
new='''      <span className="hidden sm:block">
        <Button
          variant="secondary"
          className="min-w-[13rem] justify-between text-text-muted"
          onClick={() => setOpen(true)}
          aria-label="Jump to a page (Control K)"
        >
          <span className="flex items-center gap-2 font-medium">
            <Search className="size-4" aria-hidden="true" /> Jump to…
          </span>
          <kbd className="rounded-sm border border-border bg-surface-alt px-1.5 py-0.5 font-mono text-xs">
            Ctrl K
          </kbd>
        </Button>
      </span>
      <span className="sm:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Jump to a page">
          <Search className="size-5" aria-hidden="true" />
        </Button>
      </span>
'''
t=t[:a]+new+t[b:]
open(p,'w',encoding='utf8',newline='').write(t)
