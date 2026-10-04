import json, sys

R = json.load(open('_work/register.json', encoding='utf8'))
want = set(sys.argv[1:])
for sec in ('Functional', 'NonFunctional', 'Security'):
    for d in R[sec][1:]:
        if d.get('A') in want:
            print(d['A'], '|', ' '.join((d.get('C', '') or '').split()))
            print()
