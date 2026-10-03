import os
os.chdir(r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src')


def rd(p):
    return open(p, encoding='utf8').read()


def wr(p, t):
    open(p, 'w', encoding='utf8').write(t)


def sub(t, a, b):
    assert a in t, a[:70]
    return t.replace(a, b, 1)


t = rd('app.ts')
t = sub(t, "  loginRateLimitMax?: number;\n  idp", "  loginRateLimitMax?: number;\n  /** Minutes between background alert runs (production only; alerts also fire when the alert pages are read). */\n  alertSchedulerMinutes?: number;\n  idp")
t = sub(t, "registerContractRoutes(app, API_PREFIX, guardDeps)", "registerContractRoutes(app, API_PREFIX, { ...guardDeps, schedulerMinutes: deps.alertSchedulerMinutes })")
wr('app.ts', t)

t = rd('main.ts')
t = sub(t, "    loginRateLimitMax: config.LOGIN_RATE_LIMIT_MAX,\n", "    loginRateLimitMax: config.LOGIN_RATE_LIMIT_MAX,\n    alertSchedulerMinutes: 15,\n")
wr('main.ts', t)

p = 'modules/contract/routes.ts'
t = rd(p)
t = sub(t, "export interface ContractDeps extends GuardDeps {\n  clock: Clock;\n  audit: AuditService;\n}", "export interface ContractDeps extends GuardDeps {\n  clock: Clock;\n  audit: AuditService;\n  schedulerMinutes?: number | undefined;\n}")
t = sub(t, "  alert,\n  appUser,", "  alert,\n  alertDelivery,\n  appUser,")
t = sub(t, "  contract,\n  evaluation,", "  contract,\n  contractExtension,\n  contractMilestone,\n  evaluation,")
t = sub(t, "import { createContractRecord } from './record.js';", "import { addDays, addMonths, daysBetween, iso, termBars } from './dates.js';\nimport { AlertService, createContractRecord } from './record.js';")
a = t.index("const addMonths = (iso: string, m: number) =>")
b = t.index("export function registerContractRoutes")
t = t[:a] + t[b:]
t = sub(t, "addDays(addMonths(start, l.req.termMonths ?? 12), 0)", "addMonths(start, l.req.termMonths ?? 12)")
t = sub(t, "  const evals = new EvaluationService(d.clock, d.audit);", """  const evals = new EvaluationService(d.clock, d.audit);
  const alerts = new AlertService(d.clock, d.audit);
  if (d.schedulerMinutes) {
    const h = setInterval(
      () => void alerts.runDue(d.database).catch(() => undefined),
      d.schedulerMinutes * 60_000,
    );
    h.unref();
    app.addHook('onClose', async () => clearInterval(h));
  }""")
t = sub(t, """    return {
      ...base,
      clauses: ordered.map(""", """    const record = await recordOf(tx, c);
    return {
      ...base,
      record,
      clauses: ordered.map(""")
t = sub(t, "  async function view(tx: Tx, a: AuthContext,", """  /** The management record: owner, milestones, extensions with their end dates, and the alerts with their delivery log. */
  async function recordOf(tx: Tx, c: typeof contract.$inferSelect) {
    const [owner] = c.ownerId
      ? await tx.select({ id: appUser.id, name: appUser.name }).from(appUser).where(eq(appUser.id, c.ownerId))
      : [];
    const milestones = await tx
      .select()
      .from(contractMilestone)
      .where(eq(contractMilestone.contractId, c.id))
      .orderBy(asc(contractMilestone.dueDate));
    const ext = await tx
      .select()
      .from(contractExtension)
      .where(eq(contractExtension.contractId, c.id))
      .orderBy(asc(contractExtension.position));
    const months = ext.map((e) => e.months);
    const list = await tx.select().from(alert).where(eq(alert.contractId, c.id)).orderBy(asc(alert.triggerDate));
    const deliveries = list.length
      ? await tx
          .select()
          .from(alertDelivery)
          .where(
            inArray(
              alertDelivery.alertId,
              list.map((x) => x.id),
            ),
          )
      : [];
    const bars = c.startDate && c.endDate ? termBars(c.startDate, c.endDate, months) : [];
    return {
      owner: owner ?? null,
      milestones: milestones.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate })),
      extensions: bars.filter((b) => b.optional),
      bars,
      alerts: list.map((x) =>
        alertView(
          x,
          deliveries.filter((y) => y.alertId === x.id),
        ),
      ),
    };
  }
  function alertView(x: typeof alert.$inferSelect, dl: Array<typeof alertDelivery.$inferSelect>) {
    return {
      id: x.id,
      contractId: x.contractId,
      kind: x.kind,
      triggerDate: x.triggerDate,
      recipientRule: x.recipientRule,
      status: x.status,
      origin: x.origin,
      sentAt: x.sentAt?.toISOString() ?? null,
      deliveries: dl.map((y) => ({
        channel: y.channel,
        status: y.status,
        deliveredAt: y.deliveredAt.toISOString(),
      })),
    };
  }

  async function view(tx: Tx, a: AuthContext,""")
t = sub(t, "  // ------------------------------------------------------------ awards waiting for a contract", """  // ------------------------------------------------------------ alerts and expiry (M11)
  const MANAGERS: RoleName[] = ['CONTRACT_MGR', 'PROCUREMENT', 'LEGAL', 'EXEC'];

  reg('GET', '/contracts/{id}/alerts');
  app.get(`${p}/contracts/:id/alerts`, { preHandler: guard(d, MANAGERS) }, async (req) => {
    const a = req.auth!;
    const id = cid(req);
    await alerts.runDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const c = await load(tx, a, id);
      return (await recordOf(tx, c)).alerts;
    });
  });

  reg('GET', '/alerts');
  app.get(`${p}/alerts`, { preHandler: guard(d, MANAGERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ status: z.enum(['SCHEDULED', 'SENT', 'CANCELLED']).optional() }), req.query);
    await alerts.runDue(d.database);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select({ a: alert, number: contract.number, endDate: contract.endDate })
        .from(alert)
        .innerJoin(contract, eq(contract.id, alert.contractId))
        .where(and(eq(alert.tenantId, a.user.tenantId), isNull(contract.deletedAt)))
        .orderBy(asc(alert.triggerDate));
      const dl = rows.length
        ? await tx
            .select()
            .from(alertDelivery)
            .where(
              inArray(
                alertDelivery.alertId,
                rows.map((r) => r.a.id),
              ),
            )
        : [];
      return rows
        .filter((r) => !q.status || r.a.status === q.status)
        .map((r) => ({
          ...alertView(
            r.a,
            dl.filter((y) => y.alertId === r.a.id),
          ),
          contractNumber: r.number,
          endDate: r.endDate,
        }));
    });
  });

  reg('GET', '/reports/expiring-contracts');
  app.get(`${p}/reports/expiring-contracts`, { preHandler: guard(d, MANAGERS) }, async (req) => {
    const a = req.auth!;
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(3650).default(90) }), req.query);
    const today = iso(d.clock.now());
    const horizon = addDays(today, q.days);
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(contract)
        .where(
          and(
            eq(contract.tenantId, a.user.tenantId),
            eq(contract.status, 'EXECUTED'),
            isNull(contract.deletedAt),
          ),
        );
      const out = [];
      for (const c of rows) {
        if (!c.endDate || c.endDate < today || c.endDate > horizon) continue;
        const s = await summary(tx, a.user.tenantId, c);
        const rec = await recordOf(tx, c);
        out.push({
          contractId: c.id,
          number: c.number,
          title: s.title,
          supplier: s.supplierName,
          value: s.value,
          owner: rec.owner?.name ?? null,
          startDate: c.startDate,
          endDate: c.endDate,
          noticeDeadline: addDays(c.endDate, -c.noticeDays),
          daysRemaining: daysBetween(today, c.endDate),
          optionalExtensions: rec.extensions.map((e) => ({
            months: Number(/\\((\\d+) months\\)/.exec(e.label)?.[1] ?? 0),
            endDate: e.end,
          })),
          bars: rec.bars,
        });
      }
      return out.sort((x, y) => x.daysRemaining - y.daysRemaining);
    });
  });

  // ------------------------------------------------------------ awards waiting for a contract""")
wr(p, t)

# seed: record created through the same function as at execution
p = 'db/seed.ts'
t = rd(p)
a = t.index("      const noticeDate = new Date(c.end.getTime() - (c.notice + 60) * 86_400_000);")
b = t.index("      await log(\n        'contract.sign',")
t = t[:a] + """      const [row] = await tx.select().from(s.contract).where(eq(s.contract.id, id));
      await createContractRecord(tx, row!, {
        extensions: SERVICES_TEMPLATE.extensions ?? [],
        today: dateOnly(now),
        pastAsSent: true,
        ownerId: userId('contract-mgr'),
      });
""" + t[b:]
t = sub(t, "import { SERVICES_TEMPLATE, WORKS_TEMPLATE } from '../modules/contract/clauses.js';", "import { SERVICES_TEMPLATE, WORKS_TEMPLATE } from '../modules/contract/clauses.js';\nimport { createContractRecord } from '../modules/contract/record.js';")
wr(p, t)
print('ok')
