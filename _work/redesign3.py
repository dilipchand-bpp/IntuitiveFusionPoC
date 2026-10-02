p='apps/web/src/components/landing/site-chrome.tsx'
t=open(p,encoding='utf8',newline='').read()
t=t.replace('<header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">','<header className="glass sticky top-0 z-30 border-b border-border/60">')
t=t.replace('className="flex min-h-[44px] items-center rounded-sm px-3 text-sm font-medium text-text no-underline hover:bg-surface-alt"','className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-text no-underline transition-colors hover:bg-accent/10 hover:text-accent"')
t=t.replace('''<Button asChild variant="primary">
            <Link href="/login" className="text-primary-fg no-underline">
              Log in
            </Link>
          </Button>''','''<Button asChild variant="accent">
            <Link href="/login" className="text-gradient-fg no-underline">
              Log in
            </Link>
          </Button>''')
t=t.replace('<footer className="border-t border-border bg-surface">','<footer className="relative border-t border-border bg-surface">\n      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-brand-gradient" />')
open(p,'w',encoding='utf8',newline='').write(t)
