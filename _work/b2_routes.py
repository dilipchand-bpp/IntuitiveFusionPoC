p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\routes.ts'
s = open(p, encoding='utf8').read()


def sub(a, b):
    global s
    assert a in s, a[:90]
    s = s.replace(a, b, 1)


# ---- answer audience (FR-0195)
sub("const answerBody = z.object({ answer: z.string().trim().min(2).max(4000) }).strict();",
    "const answerBody = z\n  .object({\n    answer: z.string().trim().min(2).max(4000),\n    /** ALL: published to every supplier with the next addendum. SINGLE: sent now, to the supplier who asked, only (FR-0195). */\n    audience: z.enum(['ALL', 'SINGLE']).default('ALL'),\n  })\n  .strict();")
sub("""        await tx
          .update(question)
          .set({ answer: body.answer, status: 'ANSWERED' })
          .where(eq(question.id, questionId));
        await d.audit.record(tx, a.ctx, {
          action: 'question.answer',
          entityType: 'question',
          entityId: questionId,
          after: { tenderId: id, status: 'ANSWERED' },
        });""",
    """        // A single-supplier answer is delivered at once and only to the asker; a broadcast waits for the addendum.
        const single = body.audience === 'SINGLE';
        await tx
          .update(question)
          .set({
            answer: body.answer,
            status: single ? 'PUBLISHED' : 'ANSWERED',
            audience: body.audience,
            targetSupplierId: single ? q.askedBySupplierId : null,
          })
          .where(eq(question.id, questionId));
        await d.audit.record(tx, a.ctx, {
          action: 'question.answer',
          entityType: 'question',
          entityId: questionId,
          after: { tenderId: id, status: single ? 'PUBLISHED' : 'ANSWERED', audience: body.audience },
        });
        if (single && q.askedBySupplierId) {
          const people = await tx.select().from(appUser).where(and(eq(appUser.supplierId, q.askedBySupplierId), eq(appUser.active, true)));
          for (const u of people) {
            await tx.insert(notification).values({
              tenantId: a.user.tenantId,
              userId: u.id,
              title: 'Your question was answered',
              body: `${l.req.title}: the answer is in your portal`,
              link: `/supplier/tenders/${id}`,
            });
            await sendEmail(tx, { tenantId: a.user.tenantId, to: u.email, kind: 'ANSWER', subject: 'Your question was answered', body: `Hello ${u.name}, the buyer has answered your question about ${l.req.title}. Sign in to read it.`, refType: 'tender', refId: id });
          }
        }""")

# ---- addenda: dates can move either way within the rules, and every bidder is told (FR-0210)
sub("""        newCloses = new Date(body.newClosesAt);
        if (!l.tender.closesAt || newCloses.getTime() <= l.tender.closesAt.getTime())
          throw new AppError(422, 'VALIDATION_FAILED', 'An addendum can only extend the closing time', [
            { field: 'newClosesAt', message: 'Choose a time later than the current closing time' },
          ]);""",
    """        newCloses = new Date(body.newClosesAt);
        if (newCloses.getTime() <= now.getTime())
          throw new AppError(422, 'VALIDATION_FAILED', 'The closing time must be in the future', [
            { field: 'newClosesAt', message: 'Choose a time later than now' },
          ]);
        if (l.tender.closesAt && newCloses.getTime() === l.tender.closesAt.getTime())
          throw new AppError(422, 'VALIDATION_FAILED', 'That is already the closing time', [
            { field: 'newClosesAt', message: 'Choose a different time' },
          ]);
        // moving the date either way must still leave the statutory window from when the tender opened
        const [org] = await tx.select().from(tenant).where(eq(tenant.id, a.user.tenantId));
        const minDays =
          org?.sector === 'PUBLIC'
            ? Number(((org.config ?? {}) as { statutoryMinDays?: number }).statutoryMinDays ?? 0)
            : 0;
        const w = validateWindow(l.tender.opensAt ?? now, newCloses, minDays);
        if (!w.ok)
          throw new AppError(
            422,
            'STATUTORY_WINDOW',
            `That leaves ${w.days} day(s) from publication; this organisation requires at least ${w.minDays}`,
            [{ field: 'newClosesAt', message: `Choose a closing time at least ${w.minDays} days after publication` }],
          );""")
sub("""      // Everyone who can see this tender gets the same notice at the same time (identical information for all).
      for (const uid of await svc.supplierUserIds(tx, l.tender))
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: uid,
          title: `Addendum ${number} issued`,
          body: `${l.req.title}: ${body.summary.slice(0, 140)}`,
          link: `/supplier/tenders/${id}`,
        });""",
    """      // Everyone who can see this tender gets the same notice at the same time (identical information for all):
      // in the portal and by email, including invited contacts who have not registered yet (FR-0210).
      for (const uid of await svc.supplierUserIds(tx, l.tender))
        await tx.insert(notification).values({
          tenantId: a.user.tenantId,
          userId: uid,
          title: newCloses ? `Addendum ${number}: closing time changed` : `Addendum ${number} issued`,
          body: `${l.req.title}: ${body.summary.slice(0, 140)}`,
          link: `/supplier/tenders/${id}`,
        });
      const invited = await tx.select({ email: invitation.email }).from(invitation).where(eq(invitation.tenderId, id));
      const bidders = await svc.supplierUserIds(tx, l.tender);
      const people = bidders.length ? await tx.select({ email: appUser.email }).from(appUser).where(inArray(appUser.id, bidders)) : [];
      for (const to of new Set([...invited.map((i) => i.email), ...people.map((x) => x.email)]))
        await sendEmail(tx, {
          tenantId: a.user.tenantId,
          to,
          kind: newCloses ? 'DATES_CHANGED' : 'ADDENDUM',
          subject: `${l.req.title}: addendum ${number}${newCloses ? ' (closing time changed)' : ''}`,
          body: `${body.summary}${newCloses ? ` The new closing time is ${newCloses.toISOString().slice(0, 16).replace('T', ' ')} UTC.` : ''}`,
          refType: 'tender',
          refId: id,
        });""")

# ---- invitation: the email the buyer's system would send (FR-0200)
sub("""        // The link is shown once, here. Only its hash is stored. (Real mail would send it; the mock shows it.)""",
    """        await sendEmail(tx, {
          tenantId: a.user.tenantId,
          to: i.email,
          kind: 'TENDER_INVITATION',
          subject: `Invitation to respond: ${l.req.title}`,
          body: `You are invited to respond to ${l.req.title} (${l.req.number}). A one-time registration link was issued to the buyer to pass on; it is not repeated here.`,
          refType: 'invitation',
          refId: row!.id,
        });
        // The link is shown once, here. Only its hash is stored. (Real mail would send it; the mock shows it.)""")

# ---- publish: release the pack to every invitee, record what was released, route public notices (FR-0200, FR-0140)
sub("""      // Invitation emails are queued (mock mail): one audit entry each, no personal data in it.
      const invites = await tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(eq(invitation.tenderId, id));
      for (const i of invites)
        await d.audit.record(tx, a.ctx, {
          action: 'invitation.queued',
          entityType: 'invitation',
          entityId: i.id,
          after: { tenderId: id, channel: 'EMAIL_SIMULATED' },
        });""",
    """      // The pack is generated from the completed document and released to every invitee; a fingerprint of exactly what
      // was released is recorded, so it can be shown later that nothing changed (FR-0200). Mail is simulated.
      const packFields = await svc.fields(tx, id);
      const fingerprint = createHash('sha256').update(JSON.stringify(packFields)).digest('hex');
      await d.audit.record(tx, a.ctx, {
        action: 'tender.pack_release',
        entityType: 'tender',
        entityId: id,
        after: { sha256: fingerprint, sections: packFields.length },
      });
      const invites = await tx
        .select({ id: invitation.id, email: invitation.email })
        .from(invitation)
        .where(eq(invitation.tenderId, id));
      for (const i of invites) {
        await d.audit.record(tx, a.ctx, {
          action: 'invitation.queued',
          entityType: 'invitation',
          entityId: i.id,
          after: { tenderId: id, channel: 'EMAIL_SIMULATED' },
        });
        await sendEmail(tx, {
          tenantId: a.user.tenantId,
          to: i.email,
          kind: 'TENDER_PUBLISHED',
          subject: `Tender released: ${l.req.title}`,
          body: `The tender pack for ${l.req.title} (${l.req.number}) has been released. It closes ${closes.toISOString().slice(0, 16).replace('T', ' ')} UTC. Sign in to your supplier portal to read it.`,
          refType: 'tender',
          refId: id,
        });
      }
      // Public-sector tenders at or above a register's value go to the register for that jurisdiction (simulated).
      if (org?.sector === 'PUBLIC') {
        const settings = await loadSettings(tx, a.user.tenantId);
        const value = Number(l.req.estimatedValue ?? 0);
        for (const r of settings.publicRegisters.filter((x) => x.enabled && value >= x.minValueAud)) {
          const reference = `${r.register.replace(/[^A-Za-z]/g, '').toUpperCase()}-${d.clock.now().getUTCFullYear()}-${l.req.number}`;
          const [n] = await tx
            .insert(publicNotice)
            .values({ tenantId: a.user.tenantId, tenderId: id, register: r.register, reference, status: 'SIMULATED', createdAt: now })
            .onConflictDoNothing()
            .returning({ id: publicNotice.id });
          if (n)
            await d.audit.record(tx, a.ctx, {
              action: 'tender.public_notice',
              entityType: 'tender',
              entityId: id,
              after: { register: r.register, jurisdiction: r.jurisdiction, reference, value, simulated: true },
            });
        }
      }""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
