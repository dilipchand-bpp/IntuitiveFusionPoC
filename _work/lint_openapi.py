import json,re,sys,os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=json.load(open(os.path.join(ROOT,'docs','api','openapi.json'),encoding='utf8'))
errs=[];ops=set();n=0
roles=set(s['components']['schemas']['User']['properties']['role']['enum'])
def refs(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k=='$ref': yield v
            else: yield from refs(v)
    elif isinstance(o,list):
        for v in o: yield from refs(v)
for r in set(refs(s)):
    cur=s
    for part in r[2:].split('/'):
        if part not in cur: errs.append('unresolved '+r);break
        cur=cur[part]
declared=set()
for p,item in s['paths'].items():
    for m,op in item.items():
        n+=1
        if op['operationId'] in ops: errs.append('dup opId '+op['operationId'])
        ops.add(op['operationId'])
        names={x['name'] for x in op['parameters'] if x['in']=='path'}
        want=set(re.findall(r'\{(\w+)\}',p))
        if names!=want: errs.append(f'{m} {p} path params {names} vs {want}')
        if not op['responses']: errs.append('no responses '+op['operationId'])
        if not any(k.startswith('2') for k in op['responses']): errs.append('no 2xx '+op['operationId'])
        x=op['x-roles']
        if isinstance(x,list):
            bad=set(x)-roles
            if bad: errs.append(f'bad roles {bad} in {op["operationId"]}')
        if m in('post','put','patch') and 'requestBody' not in op and 'upload' not in op['operationId'].lower() and 'File' not in op['operationId'] and op['x-roles']!='any-authenticated' and not op['operationId'] in ('submitRequest','undoInstruction','submitPlan','publishTender','submitBid','openEvaluation','openConsensus','lockConsensus','generateReport','releaseForSigning','logout','markRead'):
            errs.append('mutation without body '+op['operationId'])
        if 'x-roles' not in op: errs.append('missing x-roles')
        for c in op['responses']:
            if c not in ('200','201','202','204') and '$ref' not in op['responses'][c]: errs.append('inline error resp '+op['operationId'])
# schema sanity: every required key exists in properties
for name,sc in s['components']['schemas'].items():
    for k in sc.get('required',[]):
        if k not in sc.get('properties',{}): errs.append(f'{name}: required {k} not in properties')
print(f'operations={n} unique_opIds={len(ops)} schemas={len(s["components"]["schemas"])} error_responses={len(s["components"]["responses"])}')
print('ERRORS:' if errs else 'OpenAPI structural lint: 0 errors'); [print(' -',e) for e in errs]
sys.exit(1 if errs else 0)
