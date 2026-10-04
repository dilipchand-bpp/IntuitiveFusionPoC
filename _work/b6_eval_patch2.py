b = 'apps/api/src/modules/evaluation/'
s = open(b + 'routes.ts', encoding='utf8', newline='').read()
start = s.index("      const roles = (\n        await tx\n          .select({ role: roleAssignment.role })")
end = s.index("      return svc.view(tx, a, (await svc.load(tx, a.user.tenantId, id))!);\n    });\n    return reply.status(201).send(out);")
body = s[start:end].replace("body.userId", "userId").replace("body.stream", "stream")
s = s[:start] + "      await addPanelMember(tx, a, l, body.userId, body.stream);\n" + s[end:]
head = (
    "  async function addPanelMember(\n    tx: Tx,\n    a: AuthContext,\n    l: Loaded,\n    userId: string,\n"
    "    stream: 'TECHNICAL' | 'COMMERCIAL' | 'OTHER',\n  ) {\n    const id = l.ev.id;\n"
)
marker = "  reg('POST', '/evaluations/{id}/panel');"
assert marker in s
s = s.replace(marker, head + body + "  }\n\n" + marker, 1)
s = s.replace(
    "const coiBody = z",
    "const committeeBody = z\n  .object({\n    instruction: z.string().trim().min(3).max(200),\n    userId: uuid.optional(),\n    stream: z.enum(['TECHNICAL', 'COMMERCIAL', 'OTHER']).optional(),\n  })\n  .strict();\nconst coiBody = z",
    1,
)
s = s.replace("import { AppError, parse } from '../../http/errors.js';", "import { AppError, parse } from '../../http/errors.js';\nimport { matchPeople, parseCommittee } from '../reporting/b6-rules.js';", 1)
open(b + 'routes.ts', 'w', encoding='utf8', newline='').write(s)
print('part2 ok')
