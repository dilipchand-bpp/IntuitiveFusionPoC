def sub(p, pairs):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        assert a in t, (p, a[:60])
        t = t.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(t)
W = 'apps/web/src/'
sub(W+'app/page.tsx', [
 ('<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">\n              {trust.map(([t, d]) => (\n                <li key={t} className="card-lift rounded-lg border border-border bg-surface p-6 shadow-sm">',
  '<ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-6">\n              {trust.map(([t, d], i) => (\n                <li\n                  key={t}\n                  className={`card-lift rounded-lg border border-border bg-surface p-6 shadow-sm ${i < 3 ? \'lg:col-span-2\' : \'lg:col-span-3\'} ${i === 4 ? \'sm:col-span-2\' : \'\'}`}\n                >'),
])
# ---- login aside
sub(W+'app/login/page.tsx', [
 ('<aside className="hidden flex-col justify-between bg-primary p-10 text-primary-fg lg:flex">',
  '<aside className="bg-brand-gradient relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">\n        <span aria-hidden="true" className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />\n        <span aria-hidden="true" className="absolute -bottom-32 -left-20 size-96 rounded-full bg-white/10" />\n        <span aria-hidden="true" className="bg-grid absolute inset-0 opacity-20" />'),
 ('<Link href="/" className="w-fit text-primary-fg no-underline" aria-label="Intuitive Fusion home">','<Link href="/" className="relative w-fit text-gradient-fg no-underline" aria-label="Intuitive Fusion home">'),
 ('<div className="flex flex-col gap-6">\n          <h2 className="text-4xl font-extrabold leading-tight">','<div className="relative flex flex-col gap-8">\n          <h2 className="text-5xl font-extrabold leading-[1.08] tracking-tight">'),
 ('<ul className="flex flex-col gap-4 text-primary-fg/90">','<ul className="flex flex-col gap-4">'),
 ('<p className="text-sm text-primary-fg/80">Proof of concept · synthetic data</p>','<p className="relative text-sm opacity-90">Proof of concept · synthetic data</p>'),
])
t=open(W+'app/login/page.tsx',encoding='utf8',newline='').read()
import re
t=re.sub(r'<li className="flex gap-3">\s*<(Sparkles|ShieldCheck|UserCheck) className="size-6 shrink-0" aria-hidden="true" />',
         lambda m: '<li className="flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur">\n              <%s className="size-6 shrink-0" aria-hidden="true" />' % m.group(1), t)
t=t.replace('<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-16">','<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-16">')
t=t.replace('<h1 className="text-3xl font-bold">Sign in</h1>','<h1 className="text-4xl font-extrabold tracking-tight">Sign in</h1>')
open(W+'app/login/page.tsx','w',encoding='utf8',newline='').write(t)

# ---- shell frame
sub(W+'components/shell/shell-frame.tsx', [
 ('<header className="sticky top-0 z-30 flex items-center gap-2 bg-primary px-3 py-2 text-primary-fg sm:px-4">','<header className="glass sticky top-0 z-30 flex items-center gap-2 border-b border-border/70 px-3 py-2 text-text sm:px-4">'),
 ('className="text-primary-fg hover:bg-primary-hover lg:hidden"','className="lg:hidden"'),
 ('className="flex items-center text-primary-fg no-underline"','className="flex items-center text-text no-underline"'),
 ('<span className="mx-1 hidden rounded-full border border-primary-fg/40 px-2 py-0.5 text-xs font-semibold sm:inline">','<span className="mx-1 hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent sm:inline">'),
 ('<div className="ml-auto flex items-center gap-1 text-primary-fg [&_button]:text-primary-fg [&_button:hover]:bg-primary-hover">','<div className="ml-auto flex items-center gap-1">'),
 ('<aside className="sticky top-[56px] hidden h-[calc(100vh-56px)] w-64 shrink-0 overflow-y-auto border-r border-border bg-surface p-4 lg:block">','<aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-64 shrink-0 overflow-y-auto border-r border-border/70 bg-surface p-4 lg:block">'),
 ('<main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8">','<main id="main" tabIndex={-1} className="reveal min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8">'),
 ('<div className="min-h-screen bg-bg text-text" data-testid="shell"','<div className="bg-hero-mesh min-h-screen text-text" data-testid="shell"'),
])
# ---- nav links
sub(W+'components/shell/nav-links.tsx', [
 ("'flex min-h-[44px] items-center gap-3 rounded-sm px-3 text-sm font-medium text-text no-underline hover:bg-surface-alt',\n                        current &&\n                          'bg-surface-alt font-semibold shadow-[inset_3px_0_0_var(--if-color-accent)]',",
  "'flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium text-text no-underline transition-colors hover:bg-surface-alt',\n                        current && 'bg-accent/10 font-semibold text-accent hover:bg-accent/15',"),
 ('<p className="px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">','<p className="px-3 text-xs font-bold uppercase tracking-widest text-text-muted">'),
])
# ---- dashboard
sub(W+'app/app/dashboard/page.tsx', [
 ('<h1 className="text-3xl font-bold">Dashboard</h1>','<h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>'),
 ('<div className="min-w-0 rounded-md border border-border bg-surface p-5">','<div className="min-w-0 rounded-lg border border-border bg-surface p-6 shadow-sm">'),
 ('<div aria-hidden="true" className="mt-1 h-2 rounded-full bg-surface-alt">\n                    <div\n                      className="h-2 rounded-full bg-accent"','<div aria-hidden="true" className="mt-1.5 h-2.5 rounded-full bg-surface-alt">\n                    <div\n                      className="bg-brand-gradient h-2.5 rounded-full"'),
])
