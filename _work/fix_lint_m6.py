root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\intake'

def edit(rel, fn):
    p = root + '\\' + rel
    t = open(p, encoding='utf8', newline='').read()
    t = fn(t)
    open(p, 'w', encoding='utf8', newline='').write(t)

def routes(t):
    t = t.replace("import type { FastifyInstance } from 'fastify';", "import type { FastifyInstance, FastifyRequest } from 'fastify';", 1)
    t = t.replace("NonNullable<import('fastify').FastifyRequest['auth']>", "AuthCtx")
    t = t.replace("const ownerOnly =", "type AuthCtx = NonNullable<FastifyRequest['auth']>;\nconst ownerOnly =", 1)
    return t

def service(t):
    return t.replace("import { AuditService } from '../../audit/audit-service.js';", "import type { AuditService } from '../../audit/audit-service.js';", 1)

edit('routes.ts', routes)
edit('service.ts', service)
print('ok')
