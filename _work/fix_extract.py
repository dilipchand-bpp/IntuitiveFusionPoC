import re
p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\intake\extract.ts'
t = open(p, encoding='utf8', newline='').read()
a = t.index('const UNITS =')
b = t.index('export function matchCategory')
new = r'''const UNITS = ['Facilities', 'Procurement', 'Finance', 'Legal', 'Risk', 'Executive', 'Operations', 'Human Resources', 'Marketing'];
/** "IT" is only a business unit in unit-like phrasing ("IT team", "owned by IT") or as a bare answer, never in "IT services". */
const IT_UNIT = /\bIT (?:team|department|unit|division|branch)\b|\b(?:owned by|from|for|within|in) IT\b(?! services?)|^\s*IT\s*\.?\s*$/;
const UNIT_PATTERNS = UNITS.map((u) => [u, new RegExp(String.raw`\b${u}\b`, 'i')] as const);

export function parseBusinessUnit(text: string): string | null {
  if (IT_UNIT.test(text)) return 'IT';
  return UNIT_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
}

'''
t = t[:a] + new + t[b:]
open(p, 'w', encoding='utf8', newline='').write(t)
print('bs chars left:', t.count(chr(8)))
