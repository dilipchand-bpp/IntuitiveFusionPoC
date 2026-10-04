import glob, json, collections
rows = []
for f in sorted(glob.glob('docs/evidence/m15/axe-*.json')):
    rows += json.load(open(f, encoding='utf8'))
print(len(rows), 'combinations')
bad = [r for r in rows if r['violations']]
print('with violations:', len(bad), '| with sideways scroll:', sum(1 for r in rows if r['horizontalScroll']))
c = collections.Counter((v['id'], v['impact']) for r in bad for v in r['violations'])
print(c)
for r in bad[:40]:
    print(r['screen'], r['size'], r['scheme'], [(v['id'], v['nodes']) for v in r['violations']])
for r in rows:
    if r['horizontalScroll']: print('SCROLL', r['screen'], r['size'], r['scheme'])
