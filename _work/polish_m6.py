import re
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

def rd(p):
    return open(base + '\\' + p, encoding='utf8', newline='').read()

def wr(p, t):
    open(base + '\\' + p, 'w', encoding='utf8', newline='').write(t)

# 1. AI-drafted badge: short visible text, full instruction for assistive tech
p = r'packages\ui\src\components\display.tsx'
t = rd(p)
old = "{kind === 'simulated' ? 'Simulated AI' : 'AI-drafted – review required'}"
assert old in t
t = t.replace(old, "{kind === 'simulated' ? 'Simulated AI' : <>AI-drafted<span className=\"sr-only\"> – review required</span></>}")
wr(p, t)

# 2. Logo: optional compact mode hides the wordmark on phones
p = r'packages\ui\src\components\brand.tsx'
t = rd(p)
t = t.replace("  withName = false,\n", "  withName = false,\n  compact = false,\n", 1)
t = t.replace("  withName?: boolean;\n", "  withName?: boolean;\n  /** Hide the wordmark below the `sm` breakpoint (tight headers). */\n  compact?: boolean;\n", 1)
t = re.sub(r'\{withName && <span className="font-heading text-lg font-bold">Intuitive Fusion</span>\}',
           "{withName && (\n        <span className={cn('whitespace-nowrap font-heading text-lg font-bold', compact && 'hidden sm:inline')}>Intuitive Fusion</span>\n      )}", t)
assert 'compact &&' in t
wr(p, t)

# 3. shell header uses the compact logo (accessible name kept by aria-label on the link)
p = r'apps\web\src\components\shell\shell-frame.tsx'
t = rd(p)
assert '<Logo withName size={36} />' in t
t = t.replace('<Logo withName size={36} />', '<Logo withName compact size={36} />', 1)
wr(p, t)

# 4. chat composer wraps on narrow screens: full-width text box, buttons beneath
p = r'apps\web\src\components\requests\intake-chat.tsx'
t = rd(p)
t = t.replace('className="flex items-end gap-2 border-t border-border p-3"', 'className="flex flex-wrap items-end gap-2 border-t border-border p-3"', 1)
t = t.replace('className="min-h-[44px] flex-1 resize-none', 'className="min-h-[44px] min-w-0 basis-full resize-none sm:flex-1 sm:basis-0', 1)
wr(p, t)

# 5. e2e expectations use the accessible name (visible text is now just "AI-drafted")
p = r'e2e\intake.spec.ts'
t = rd(p)
t = t.replace("getByText('AI-drafted – review required')", "getByText('AI-drafted')")
wr(p, t)
print('ok')
