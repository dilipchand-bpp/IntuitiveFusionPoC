import re, glob
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

def rd(p):
    return open(base + '\\' + p, encoding='utf8', newline='').read()

def wr(p, t):
    open(base + '\\' + p, 'w', encoding='utf8', newline='').write(t)

# --- forms are inert until the page has hydrated: a click before React is ready would submit natively and just reload
for p, fn in [(r'apps\web\src\app\login\login-form.tsx', 'LoginForm'), (r'apps\web\src\app\forgot-password\forgot-form.tsx', 'ForgotForm')]:
    t = rd(p)
    assert "import { useState" in t or "import { useState," in t, p
    t = re.sub(r"import \{ useState,", "import { useEffect, useState,", t, count=1) if "useEffect" not in t else t
    t = t.replace("import { useState }", "import { useEffect, useState }", 1) if "useEffect" not in t else t
    marker = "  const [busy, setBusy] = useState(false);"
    assert marker in t, p
    t = t.replace(marker, marker + "\n  const [ready, setReady] = useState(false); // submit stays disabled until hydrated\n  useEffect(() => setReady(true), []);", 1)
    t = re.sub(r"<Button type=\"submit\" loading=\{busy\}", '<Button type="submit" loading={busy} disabled={!ready}', t, count=1)
    assert 'disabled={!ready}' in t, p
    wr(p, t)

# --- chat form advertises when it is interactive
p = r'apps\web\src\components\requests\intake-chat.tsx'
t = rd(p)
old = '<form onSubmit={send}'
assert old in t
t = t.replace(old, '<form data-ready={convId ? \'true\' : \'false\'} onSubmit={send}', 1)
wr(p, t)

# --- e2e specs: use configured URLs
for f in glob.glob(base + r'\e2e\*.ts'):
    s = open(f, encoding='utf8', newline='').read()
    s2 = s.replace("'http://localhost:4000/api/v1/health'", "`${API_URL}/api/v1/health`").replace("http://localhost:4000/api/v1/health", "${API_URL}/api/v1/health")
    if s2 != s:
        s2 = "import { API_URL } from '../playwright.config';\n" + s2
        open(f, 'w', encoding='utf8', newline='').write(s2)
        print('patched', f)

# --- voice/enter test waits for the chat to be interactive
p = r'e2e\intake.spec.ts'
t = rd(p)
old = "    const box = page.getByLabel('Describe what you need or answer the question');\n    await box.fill('Catering for 12 months at $40,000');"
if old in t:
    t = t.replace(old, "    await expect(page.getByRole('form', { name: 'Message the assistant' })).toHaveAttribute('data-ready', 'true');\n" + old, 1)
    wr(p, t)
print('ok')
