p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\supplier-routes.ts'
s = open(p, encoding='utf8').read()


def sub(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


sub("import { AppError, parse } from '../../http/errors.js';",
    "import { MockSanctionsScreening, type SanctionsScreening } from '../../adapters/sanctions.js';\nimport { AppError, parse } from '../../http/errors.js';\nimport { dispatch, usersWithRole } from '../notify/dispatch.js';\nimport { sendEmail } from '../notify/email.js';\nimport { loadSettings } from '../settings/settings.js';")
sub("  /** Attempts per 15 minutes per address on the public registration routes. */\n  publicRateLimitMax?: number;\n}",
    "  /** Attempts per 15 minutes per address on the public registration routes. */\n  publicRateLimitMax?: number;\n  /** Sanctions and watchlist screening at onboarding (FR-0180). Defaults to the synthetic list. */\n  sanctions?: SanctionsScreening;\n}")
sub("    password: z.string().min(12).max(200),\n  })\n  .strict();\nconst askBody",
    "    password: z.string().min(12).max(200),\n    /** Answers to the organisation's onboarding questions, by question key (FR-0215). */\n    answers: z.record(z.string().max(60), z.string().max(2000)).optional(),\n    /** The supplier's own privacy choices for their portal (FR-0240). */\n    privacy: z.object({ shareProfile: z.boolean(), productUpdates: z.boolean() }).strict().optional(),\n  })\n  .strict();\nconst askBody")
sub("  const svc = new TenderService(d.clock, d.audit, d.store);\n  const fresh = () => svc.closeDue(d.database);",
    "  const svc = new TenderService(d.clock, d.audit, d.store);\n  const screening = d.sanctions ?? new MockSanctionsScreening();\n  const fresh = () => svc.closeDue(d.database);")

# quarantine: a supplier on hold cannot reach tender documents or bid
sub("""    const r = await withContext(d.database, a.ctx, async (tx) => {
      const l = await svc.supplierAccess(tx, a, id);
      return l ? { ok: true as const, value: await fn(tx, l) } : { ok: false as const };
    });""", """    const r = await withContext(d.database, a.ctx, async (tx) => {
      await assertNotQuarantined(tx, a);
      const l = await svc.supplierAccess(tx, a, id);
      return l ? { ok: true as const, value: await fn(tx, l) } : { ok: false as const };
    });""")
sub("  /** Runs `fn` as the signed-in supplier on a tender they may see;", """  /** A supplier whose screening matched a watchlist is held: no tender documents, no bidding, until procurement reviews (FR-0180). */
  async function assertNotQuarantined(tx: Tx, a: AuthContext) {
    if (!a.user.supplierId) return;
    const [s] = await tx.select({ st: supplier.sanctionsStatus }).from(supplier).where(eq(supplier.id, a.user.supplierId));
    if (s?.st === 'MATCH')
      throw new AppError(
        403,
        'SUPPLIER_QUARANTINED',
        'Your account is on hold while a screening result is reviewed. The buyer will contact you.',
      );
  }

  /** Runs `fn` as the signed-in supplier on a tender they may see;""")

# the public question list the registration form shows
sub("  // ---------------------------------------------------------------- self-registration (public, US-SUP-01)",
    """  // ---------------------------------------------------------------- onboarding questions (public, FR-0215)
  reg('GET', '/supplier/onboarding-questions');
  app.get(`${p}/supplier/onboarding-questions`, { preHandler: guard(d, 'public'), ...publicLimit }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(100).optional() }), req.query);
    return withSystem(d.database, async (tx) => {
      let tenantId: string | undefined;
      if (token) {
        const [inv] = await tx.select().from(invitation).where(eq(invitation.tokenHash, hashToken(token)));
        tenantId = inv?.tenantId;
      }
      if (!tenantId) {
        const [org] = await tx.select().from(tenant).where(eq(tenant.slug, d.config.DEFAULT_TENANT_SLUG));
        tenantId = org?.id;
      }
      if (!tenantId) return [];
      return (await loadSettings(tx, tenantId)).onboardingQuestions.map(({ id, label, type, mandatory }) => ({
        id,
        label,
        type,
        mandatory,
      }));
    });
  });

  // ---------------------------------------------------------------- self-registration (public, US-SUP-01)""")

# registration: answers, sanctions, privacy, welcome email
sub("""      const passwordHash = await argon2Hash(b.password);
      const abn = b.abn.replace(/\\s+/g, '');
      const out = await withSystem(d.database, async (tx) => {""",
    """      const passwordHash = await argon2Hash(b.password);
      const abn = b.abn.replace(/\\s+/g, '');
      // screened before anything is stored; a match holds the account rather than refusing it (FR-0180)
      const screen = await screening.screen({ company: b.company, abn });
      const out = await withSystem(d.database, async (tx) => {""")
sub("""        const [sup] = await tx
          .insert(supplier)
          .values({
            tenantId,
            company: b.company,
            abn,
            sanctionsStatus: 'PENDING',
            insuranceStatus: 'UNKNOWN',
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, sys, {
          action: 'supplier.register',
          entityType: 'supplier',
          entityId: sup!.id,
          after: { company: b.company, sanctionsStatus: 'PENDING' },
        });""",
    """        // the organisation's own onboarding questions: required ones must be answered, and a flagged answer is noted (FR-0215)
        const settings = await loadSettings(tx, tenantId);
        const answers = b.answers ?? {};
        const missingAnswers = settings.onboardingQuestions.filter((q) => q.mandatory && !answers[q.id]?.trim());
        if (missingAnswers.length > 0)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'Please answer the required questions',
            missingAnswers.map((q) => ({ field: `answers.${q.id}`, message: `${q.label} is required` })),
          );
        const badYesNo = settings.onboardingQuestions.filter(
          (q) => q.type === 'YESNO' && answers[q.id] !== undefined && !['YES', 'NO'].includes(answers[q.id]!),
        );
        if (badYesNo.length > 0)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'Answer yes or no',
            badYesNo.map((q) => ({ field: `answers.${q.id}`, message: 'Answer yes or no' })),
          );
        const flagged = settings.onboardingQuestions
          .filter((q) => q.type === 'YESNO' && q.flagIf && answers[q.id] === q.flagIf)
          .map((q) => q.id);
        const [sup] = await tx
          .insert(supplier)
          .values({
            tenantId,
            company: b.company,
            abn,
            sanctionsStatus: screen.status,
            sanctionsNote: screen.reason ?? null,
            insuranceStatus: 'UNKNOWN',
            onboarding: {
              answers: Object.fromEntries(settings.onboardingQuestions.filter((q) => answers[q.id] !== undefined).map((q) => [q.id, answers[q.id]])),
              flagged,
              answeredAt: now.toISOString(),
            },
            privacy: b.privacy ?? { shareProfile: true, productUpdates: false },
            lastCheckedAt: now,
            createdAt: now,
          })
          .returning();
        await d.audit.record(tx, sys, {
          action: 'supplier.register',
          entityType: 'supplier',
          entityId: sup!.id,
          after: { company: b.company, sanctionsStatus: screen.status, flaggedAnswers: flagged },
        });
        const team = await usersWithRole(tx, tenantId, ['PROCUREMENT']);
        if (screen.status === 'MATCH') {
          // quarantine: the account exists but cannot reach tender documents; procurement is alerted (FR-0180)
          await d.audit.record(tx, sys, {
            action: 'supplier.sanctions_match',
            entityType: 'supplier',
            entityId: sup!.id,
            after: { list: screen.list ?? null, held: true },
            result: 'DENIED',
          });
          await dispatch(
            tx,
            { tenantId, recipients: team, title: 'Supplier on hold: screening match', body: `${b.company} matched a watchlist at registration and is held until reviewed.`, link: `/app/suppliers/${sup!.id}` },
            settings,
          );
        } else if (flagged.length > 0) {
          await dispatch(
            tx,
            { tenantId, recipients: team, title: 'Supplier answered a screening question for review', body: `${b.company} gave an answer that needs a look before they bid.`, link: `/app/suppliers/${sup!.id}` },
            settings,
          );
        }""")
sub("        return { registered: true, supplierId: sup!.id, sanctionsStatus: sup!.sanctionsStatus };",
    """        await sendEmail(tx, {
          tenantId,
          to: b.email,
          kind: screen.status === 'MATCH' ? 'SANCTIONS_HOLD' : 'WELCOME',
          subject: screen.status === 'MATCH' ? 'Your supplier account is on hold' : 'Your supplier portal is ready',
          body:
            screen.status === 'MATCH'
              ? `Hello ${b.name}, your account for ${b.company} has been created but is on hold while a screening result is reviewed by the buyer.`
              : `Hello ${b.name}, your supplier portal for ${b.company} is ready. Sign in to see the tenders you are invited to.`,
          refType: 'supplier',
          refId: sup!.id,
        });
        return { registered: true, supplierId: sup!.id, sanctionsStatus: sup!.sanctionsStatus };""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
