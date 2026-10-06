API = 'apps/api/src/'


def edit(p, pairs, imp=None, base=API):
    s = open(base + p, encoding='utf8', newline='').read().replace('\r\n', '\n')
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    if imp:
        i = s.index('import ')
        s = s[:i] + imp + '\n' + s[i:]
    open(base + p, 'w', encoding='utf8', newline='').write(s)


edit('modules/intake/service.ts', [
    ("  estimatedValue: number;\n  currency: string;\n  termMonths?: number;", "  /** Always in the base currency (AUD), so every total and every approval limit uses one currency. */\n  estimatedValue: number;\n  currency: string;\n  /** When the amount was typed in a foreign currency: that amount and the rate used to convert it (FR-0810). */\n  originalAmount?: number;\n  fxRate?: number;\n  termMonths?: number;"),
    ("    currency: r.currency,\n    ...(r.termMonths", "    currency: r.currency,\n    ...(r.originalAmount !== null ? { originalAmount: Number(r.originalAmount) } : {}),\n    ...(r.fxRate !== null ? { fxRate: Number(r.fxRate) } : {}),\n    ...(r.termMonths"),
])

edit('modules/intake/routes.ts', [
    ("    estimatedValue: z.number().min(0).max(1e12).optional(),\n    termMonths", "    /** The amount, in `currency` when one is given (otherwise in the request's own currency). */\n    estimatedValue: z.number().min(0).max(1e12).optional(),\n    currency: z.enum(SUPPORTED).optional(),\n    termMonths"),
    ("""      const row = await svc.createDraft(tx, a.ctx);
      const changes = toChanges(body);
      if (changes.length === 0) {
        const l = (await loadRequest(tx, a.user.tenantId, row.id))!;
        return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
      }
      return svc.applyChanges(tx, a.ctx, row.id, changes, 'USER', await tenantConfig(tx, a.user.tenantId));""", """      const row = await svc.createDraft(tx, a.ctx);
      const money = await moneyOf(tx, a.user.tenantId, body, 'AUD', d.clock.now());
      const changes = toChanges(money.body);
      if (changes.length === 0 && !money.touched) {
        const l = (await loadRequest(tx, a.user.tenantId, row.id))!;
        return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
      }
      if (changes.length) await svc.applyChanges(tx, a.ctx, row.id, changes, 'USER', await tenantConfig(tx, a.user.tenantId));
      return keepMoney(tx, a, row.id, money);"""),
    ("""      const changes = toChanges(body);
      if (changes.length === 0) return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
      return svc.applyChanges(tx, a.ctx, id, changes, 'USER', await tenantConfig(tx, a.user.tenantId));""", """      const money = await moneyOf(tx, a.user.tenantId, body, l.row.currency, d.clock.now());
      const changes = toChanges(money.body);
      if (changes.length === 0 && !money.touched) return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
      if (changes.length) await svc.applyChanges(tx, a.ctx, id, changes, 'USER', await tenantConfig(tx, a.user.tenantId));
      return keepMoney(tx, a, id, money);"""),
    ("  reg('GET', '/requests/{id}');", """  /**
   * An amount typed in a foreign currency is converted once, here, and the request keeps the original and the rate. When the
   * amount is sent without a currency, it is in the currency the request already has (FR-0810).
   */
  async function moneyOf(tx: Parameters<Parameters<typeof withContext>[2]>[0], tenantId: string, body: z.infer<typeof patchBody>, current: string, now: Date) {
    const cur = body.currency ?? current;
    const out: { body: z.infer<typeof patchBody>; touched: boolean; currency: string; original: number | null; rate: number | null } = {
      body: { ...body },
      touched: false,
      currency: cur,
      original: null,
      rate: null,
    };
    delete out.body.currency;
    if (body.estimatedValue === undefined) {
      if (body.currency && body.currency !== current) {
        if (isForeign(body.currency))
          throw new AppError(422, 'VALIDATION_FAILED', 'Enter the amount in that currency too', [{ field: 'estimatedValue', message: `Give the value in ${body.currency}` }]);
        out.touched = true; // back to the base currency: the value stays as it is
        out.currency = 'AUD';
      }
      return out;
    }
    out.touched = true;
    if (!isForeign(cur)) {
      out.currency = 'AUD';
      return out;
    }
    const c = await toBaseAmount(tx, tenantId, cur, body.estimatedValue, now.toISOString().slice(0, 10));
    out.body.estimatedValue = c.base;
    out.original = c.original;
    out.rate = c.rate;
    return out;
  }
  /** Writes the currency, the original amount and the rate beside the converted value, and returns the fresh view. */
  async function keepMoney(tx: Parameters<Parameters<typeof withContext>[2]>[0], a: AuthContext, id: string, m: Awaited<ReturnType<typeof moneyOf>>) {
    if (m.touched)
      await tx
        .update(request)
        .set({ currency: m.currency, originalAmount: m.original === null ? null : String(m.original), fxRate: m.rate === null ? null : String(m.rate) })
        .where(eq(request.id, id));
    const l = (await loadRequest(tx, a.user.tenantId, id))!;
    return toView(l.row, l.fields, await loadSettings(tx, a.user.tenantId));
  }

  reg('GET', '/requests/{id}');"""),
], "import { SUPPORTED, isForeign } from '../b9/fx-rules.js';\nimport { toBaseAmount } from '../b9/fx-routes.js';")
print('ok')
