import re
root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src'

def rd(rel):
    return open(root + '\\' + rel, encoding='utf8', newline='').read()

def wr(rel, t):
    open(root + '\\' + rel, 'w', encoding='utf8', newline='').write(t)

# ---- app.ts: ERP mock no longer queries the DB
t = rd('app.ts')
a = t.index('  const erp =\n    deps.erp ??')
b = t.index('  for (const k of registerIntakeRoutes')
t = t[:a] + '  const erp = deps.erp ?? new MockErpBudgetService();\n' + t[b:]
t = t.replace("import { eq } from 'drizzle-orm';\n", '').replace("import { tenant } from './db/schema.js';\n", '')
wr('app.ts', t)

# ---- routes.ts: pass settings
t = rd(r'modules\intake\routes.ts')
m = re.search(r'await d\.erp\.check\(\{(.*?)\}\)', t, re.S)
assert m
inner = m.group(1)
if 'settings' not in inner:
    t = t[:m.start(1)] + inner.rstrip().rstrip(',') + ', settings: cfg ' + t[m.end(1):]
wr(r'modules\intake\routes.ts', t)

# ---- extract.ts: business unit only from capitalised names or explicit cues
t = rd(r'modules\intake\extract.ts')
a = t.index('const UNITS =')
b = t.index('export function matchCategory')
new = r'''export const UNITS = ['Facilities', 'Procurement', 'Finance', 'Legal', 'Risk', 'Executive', 'Operations', 'Human Resources', 'Marketing'];
/** "IT" is only a business unit in unit-like phrasing ("IT team", "owned by IT") or as a bare answer, never in "IT services". */
const IT_UNIT = /\bIT (?:team|department|unit|division|branch)\b|\b(?:owned by|from|for|within|in) IT\b(?! services?)|^\s*IT\s*\.?\s*$/;
// A unit is recognised when written as a proper name ("for Facilities") or after an explicit cue ("owned by facilities").
// Lower-case "facilities cleaning" is a kind of service, not the owning unit, so it is not matched.
const UNIT_PATTERNS = UNITS.map((u) => [u, new RegExp(String.raw`\b${u}\b`), new RegExp(String.raw`\b(?:owned by|from|within|unit is|department is|team is|belongs to)\s+${u}\b`, 'i')] as const);

export function parseBusinessUnit(text: string): string | null {
  if (IT_UNIT.test(text)) return 'IT';
  return UNIT_PATTERNS.find(([, proper, cued]) => proper.test(text) || cued.test(text))?.[0] ?? null;
}

/** Maps a typed answer such as "facilities" to the canonical unit name when it is one we know. */
export function canonicalUnit(answer: string): string | null {
  const a = answer.trim().replace(/\.$/, '');
  if (/^it$/i.test(a)) return 'IT';
  return UNITS.find((u) => u.toLowerCase() === a.toLowerCase()) ?? null;
}

/** A plausible short free-text answer: a few words, no sentence punctuation (so a pasted instruction is rejected). */
export const looksLikeShortAnswer = (answer: string): boolean => {
  const t = answer.trim();
  return t.length > 0 && t.length <= 60 && t.split(/\s+/).length <= 6 && !/[.;:!?]\s|[;:!?]$/.test(t);
};

'''
t = t[:a] + new + t[b:]
wr(r'modules\intake\extract.ts', t)

# ---- ai-provider: use the stricter rules for pending answers
t = rd(r'adapters\ai-provider.ts')
t = t.replace("import { CATEGORIES, extractFromText, parseMoney, parseTermMonths } from '../modules/intake/extract.js';",
              "import { CATEGORIES, canonicalUnit, extractFromText, looksLikeShortAnswer, parseMoney, parseTermMonths } from '../modules/intake/extract.js';")
old = "      } else if (ex.mentioned.length === 0 && answer.length > 0 && answer.length <= 120) {\n        changes.set(asked, answer);\n      }"
assert old in t
t = t.replace(old, """      } else if (asked === 'businessUnit') {
        const unit = canonicalUnit(answer);
        if (unit) changes.set(asked, unit);
        else if (ex.mentioned.length === 0 && looksLikeShortAnswer(answer)) changes.set(asked, answer);
      } else if (ex.mentioned.length === 0 && looksLikeShortAnswer(answer)) {
        changes.set(asked, answer);
      }""")
wr(r'adapters\ai-provider.ts', t)
print('ok')
