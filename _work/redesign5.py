p='apps/web/src/app/page.tsx'
t=open(p,encoding='utf8',newline='').read()
a="                  className={\n                    i === 0\n                      ? 'card-lift reveal-scroll flex flex-col gap-3 rounded-lg bg-brand-gradient p-6 shadow-md sm:col-span-2 lg:row-span-1'\n                      : 'card-lift reveal-scroll flex flex-col gap-3 rounded-lg border border-border bg-surface p-6 text-text shadow-sm'\n                  }"
assert a in t
b="                  className={`card-lift reveal-scroll flex flex-col gap-3 rounded-lg p-6 shadow-sm ${\n                    i === 0\n                      ? 'bg-brand-gradient shadow-md'\n                      : 'border border-border bg-surface text-text'\n                  } ${[0, 3, 6, 7].includes(i) ? 'sm:col-span-2' : ''}`}"
t=t.replace(a,b)
open(p,'w',encoding='utf8',newline='').write(t)
