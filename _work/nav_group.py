import re

p = 'apps/web/src/lib/nav.ts'
s = open(p, encoding='utf8', newline='').read()

SECTION = {
    '/app/dashboard': 'Overview',
    '/app/requests': 'Procure',
    '/app/plans': 'Procure',
    '/app/approvals': 'Procure',
    '/app/tenders': 'Procure',
    '/app/evaluations': 'Procure',
    '/app/suppliers': 'Procure',
    '/app/contracts': 'Contracts',
    '/app/envelopes': 'Contracts',
    '/app/legal': 'Contracts',
    '/app/reports': 'Insight',
    '/app/reports/ask': 'Insight',
    '/app/reports/schedule': 'Insight',
    '/app/reports/supplier-risk': 'Insight',
    '/app/collaboration': 'Collaborate',
    '/app/shared': 'Collaborate',
    '/app/probity': 'Oversight',
    '/app/audit': 'Oversight',
    '/app/roadmap': 'Oversight',
}
ORDER = ['Overview', 'Procure', 'Contracts', 'Insight', 'Collaborate', 'Oversight', 'Administration', 'Supplier']

start = s.index('export const NAV')
arr_open = s.index('= [', start) + 3
arr_close = s.index('\n];', arr_open)
body = s[arr_open:arr_close]
items = re.split(r'(?=\n  \{\n    href:)', body)
head, blocks = items[0], items[1:]
out = []
for b in blocks:
    href = re.search(r"href: '([^']+)'", b).group(1)
    if href == '/app/dashboards':
        continue  # role dashboards now sit on the Dashboard page itself
    sec = SECTION.get(href)
    if sec:
        b = re.sub(r"section: '[A-Za-z]+'", f"section: '{sec}'", b, count=1)
    out.append((href, re.search(r"section: '([A-Za-z]+)'", b).group(1), b))
out.sort(key=lambda t: ORDER.index(t[1]))
s = s[:arr_open] + head + ''.join(b for _, _, b in out) + s[arr_close:]
s = s.replace("section: 'Work' | 'Oversight' | 'Administration' | 'Supplier';",
              "section: 'Overview' | 'Procure' | 'Contracts' | 'Insight' | 'Collaborate' | 'Oversight' | 'Administration' | 'Supplier';")
open(p, 'w', encoding='utf8', newline='').write(s)
print([h for h, _, _ in out])
