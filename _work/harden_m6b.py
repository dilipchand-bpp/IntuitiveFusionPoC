import re, glob
base = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

def rd(p):
    return open(base + '\\' + p, encoding='utf8', newline='').read()

def wr(p, t):
    open(base + '\\' + p, 'w', encoding='utf8', newline='').write(t)

for p in (r'apps\web\src\app\login\login-form.tsx', r'apps\web\src\app\forgot-password\forgot-form.tsx'):
    t = rd(p)
    print(p, 'ready' in t, 'disabled={!ready}' in t)

# chat form advertises when it is interactive
p = r'apps\web\src\components\requests\intake-chat.tsx'
t = rd(p)
m = re.search(r'<form\s+onSubmit=\{send\}', t)
assert m, 'chat form not found'
t = t[:m.start()] + "<form data-ready={convId ? 'true' : 'false'} onSubmit={send}" + t[m.end():]
wr(p, t)

# e2e specs use the configured API URL
for f in glob.glob(base + r'\e2e\*.ts'):
    s = open(f, encoding='utf8', newline='').read()
    s2 = s.replace("'http://localhost:4000/api/v1/health'", "`${API_URL}/api/v1/health`").replace("http://localhost:4000/health", "${API_URL}/health")
    if s2 != s and 'API_URL }' not in s2.split('\n')[0]:
        s2 = "import { API_URL } from '../playwright.config';\n" + s2
    if s2 != s:
        open(f, 'w', encoding='utf8', newline='').write(s2)
        print('patched', f)

# voice/enter test waits until the chat is interactive
p = r'e2e\intake.spec.ts'
t = rd(p)
m = re.search(r"(\s+)const box = page\.getByLabel\('Describe what you need or answer the question'\);\s+await box\.fill\('Catering for 12 months at \$40,000'\);", t)
if m:
    ins = m.group(1) + "await expect(page.getByRole('form', { name: 'Message the assistant' })).toHaveAttribute('data-ready', 'true');"
    t = t[:m.start()] + ins + t[m.start():]
    wr(p, t)
    print('voice test patched')
print('done')
