import json
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\package.json'
d = json.load(open(p, encoding='utf8'))
s = d['scripts']
s['predev'] = 'node scripts/ensure-env.mjs'
s['db:reset'] = 'node scripts/ensure-env.mjs && npm run db:reset -w @if/api && npm run db:seed -w @if/api'
s['db:seed'] = 'node scripts/ensure-env.mjs && npm run db:seed -w @if/api'
json.dump(d, open(p, 'w', encoding='utf8'), indent=2)
print(s['dev'])
