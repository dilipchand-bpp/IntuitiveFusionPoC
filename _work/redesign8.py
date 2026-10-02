def sub(p, pairs):
    t = open(p, encoding='utf8', newline='').read()
    for a, b in pairs:
        assert a in t, (p, a[:60])
        t = t.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(t)
sub('packages/ui/src/components/display.tsx',[("'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',","'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',")])
sub('apps/web/src/components/shell/shell-frame.tsx',[
 ("import { NavLinks } from './nav-links';","import { CommandPalette } from './command-palette';\nimport { NavLinks } from './nav-links';"),
 ('<div className="ml-auto flex items-center gap-1">','<div className="ml-auto flex items-center gap-1">\n          <CommandPalette items={items} />'),
])
