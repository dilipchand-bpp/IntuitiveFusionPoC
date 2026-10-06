import re, sys, collections
sys.path.insert(0, '_work')
from triage import T

titles = {}
cur = None
for line in open('_work/deferred_list.txt', encoding='utf8'):
    m = re.match(r'^((?:FR|NFR|SEC)-[A-Z]*\d+) \[([^\]]+)\] (.*)$', line.rstrip())
    if m:
        titles[m.group(1)] = (m.group(2), m.group(3))

BATCH = {
    'B8': 'Tender, contract and supplier intelligence',
    'B9': 'Planning, spend and experience',
    'B10': 'Integrations and the AI layer',
    'B11': 'Security and data protection controls',
    'B12': 'Operations, resilience and evidence',
}
CLASS = {
    'BUILD': 'Built and tested as a working feature',
    'SIM': 'Works against a labelled simulated outside system; the swap point is documented',
    'EVIDENCE': 'A control, policy or runbook that is implemented and tested here',
    'DESIGN': 'Cannot run on one laptop: delivered as a design and the configuration to apply, and shown on the roadmap as designed, not built',
}
c = collections.Counter(k for _, k, _ in T.values())
out = [
    '# Plan for the requirements listed as "Not in the proof of concept"',
    '',
    f'{len(T)} requirements, in five batches. Each batch ends with its own evidence document and your approval before the next starts.',
    '',
    '## How each one is delivered',
    '',
    '| Kind | Count | Meaning |',
    '| --- | ---: | --- |',
]
for k in ['BUILD', 'SIM', 'EVIDENCE', 'DESIGN']:
    out.append(f'| {k.title()} | {c[k]} | {CLASS[k]} |')
out += [
    '',
    'Nothing in the Design kind will be described as built. Those requirements need production hosting, a cloud edge, an external assessor or a real third party, and a proof-of-concept laptop cannot supply them. For each, the batch delivers the design, the rules or configuration to apply, and what would be needed to prove it.',
    '',
]
for b, name in BATCH.items():
    ids = [i for i, v in T.items() if v[0] == b]
    out += [f'## {b}: {name} ({len(ids)})', '', '| Requirement | Priority | Kind | What will be delivered |', '| --- | --- | --- | --- |']
    for i in sorted(ids, key=lambda x: (x.split('-')[0], x)):
        pr = titles[i][0]
        out.append(f'| {i} | {pr} | {T[i][1].title()} | {T[i][2]} |')
    out.append('')
open('docs/Deferred-Plan.md', 'w', encoding='utf8', newline='\n').write('\n'.join(out))
print('ok', len(out))
