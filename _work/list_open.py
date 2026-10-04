import re, sys

s = open('packages/shared/src/roadmap-data.ts', encoding='utf8').read()
blocks = re.split(r"\n  \{\n", s)[1:]
cats = sys.argv[1:]
Q = "'"
BS = chr(92)
val = r"((?:[^" + Q + BS + BS + r"]|" + BS + BS + r".)*)"


def g(b, k):
    m = re.search(k + ": " + Q + val + Q, b)
    return m.group(1) if m else ''


for b in blocks:
    t = re.search(r"title:\s*" + Q + val + Q, b)
    if g(b, 'category') in cats and g(b, 'status') != 'BUILT' and g(b, 'tier') != 'D':
        print(g(b, 'id'), g(b, 'status'), g(b, 'tier'), '|', (t.group(1) if t else '')[:200])
