p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src\lib\nav.ts'
t = open(p, encoding='utf8', newline='').read()
import re
m = re.search(r"(href: '/app/requests',[^\n]*?roles: )\[[^\]]*\]", t, re.S)
assert m, 'requests nav not found'
t = t[:m.start()] + m.group(1) + "['REQUESTER', 'PROCUREMENT', 'DELEGATE', 'LEGAL', 'CONTRACT_MGR', 'PROBITY', 'FINANCE', 'EXEC']" + t[m.end():]
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
