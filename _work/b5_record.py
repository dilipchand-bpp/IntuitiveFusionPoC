p = 'apps/api/src/modules/contract/record.ts'
s = open(p, encoding='utf8').read()


def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)


rep("""import { and, eq, inArray, isNull, lte } from 'drizzle-orm';""", """import { and, eq, inArray, isNull, lte, ne } from 'drizzle-orm';""")
rep("""import {
  alert,
  alertDelivery,
  appUser,""", """import {
  alert,
  alertDelivery,
  alertPreference,
  appUser,""")
rep("""import { daysBetween, defaultMilestones, iso, leadsFrom, scheduleAlerts } from './dates.js';""", """import { countdownAlerts, MANDATORY_KINDS } from './b5-rules.js';
import { runComplianceSweep } from './compliance.js';
import { daysBetween, defaultMilestones, iso, leadsFrom, scheduleAlerts } from './dates.js';""")

# create record: countdown alerts
rep("""        ...(opts.pastAsSent && a.triggerDate < opts.today ? { status: 'SENT' as const } : {}),
      })
      .onConflictDoNothing();
  return { ownerId, milestones, alerts };""", """        ...(opts.pastAsSent && a.triggerDate < opts.today ? { status: 'SENT' as const } : {}),
      })
      .onConflictDoNothing();
  // the fixed countdown (FR-0510): 180, 90 and 60 days before expiry and before the extension decision closes
  const fixed = countdownAlerts(
    { endDate: c.endDate!, noticeDays: c.noticeDays, hasExtensions: opts.extensions.length > 0 },
    opts.today,
  );
  for (const a of fixed)
    await tx
      .insert(alert)
      .values({
        tenantId: c.tenantId,
        contractId: c.id,
        kind: 'COUNTDOWN',
        triggerDate: a.triggerDate,
        origin: 'SYSTEM',
        note: a.note,
      })
      .onConflictDoNothing();
  return { ownerId, milestones, alerts: [...alerts, ...fixed] };""")

# reschedule keeps INSURANCE, re-adds countdown
rep("""  await tx
    .delete(alert)
    .where(and(eq(alert.contractId, c.id), eq(alert.origin, 'SYSTEM'), eq(alert.status, 'SCHEDULED')));""", """  await tx
    .delete(alert)
    .where(
      and(
        eq(alert.contractId, c.id),
        eq(alert.origin, 'SYSTEM'),
        eq(alert.status, 'SCHEDULED'),
        ne(alert.kind, 'INSURANCE'),
      ),
    );""")
rep("""        origin: 'SYSTEM',
      })
      .onConflictDoNothing();
  return planned.length;""", """        origin: 'SYSTEM',
      })
      .onConflictDoNothing();
  const fixed = countdownAlerts(
    { endDate: end, noticeDays: c.noticeDays, hasExtensions: ext.length > 0 },
    today,
  );
  for (const a of fixed)
    await tx
      .insert(alert)
      .values({
        tenantId: c.tenantId,
        contractId: c.id,
        kind: 'COUNTDOWN',
        triggerDate: a.triggerDate,
        origin: 'SYSTEM',
        note: a.note,
      })
      .onConflictDoNothing();
  return planned.length + fixed.length;""")

rep("""  CUSTOM: 'Your reminder',
};""", """  CUSTOM: 'Your reminder',
  COUNTDOWN: 'The contract is counting down to expiry',
  INSURANCE: "The supplier's insurance certificate is about to expire",
  CLAUSE: 'A date taken from the contract wording is coming up',
};""")

rep("""    const today = iso(this.clock.now());
    const now = this.clock.now();
    return withSystem(database, async (tx) => {
      const due = await tx""", """    const today = iso(this.clock.now());
    const now = this.clock.now();
    return withSystem(database, async (tx) => {
      await runComplianceSweep(tx, this.audit, now);
      const due = await tx""")

rep("""        const body = `${c.number}${req ? ` ${req.title}` : ''}: ${a.note ? `Your reminder: "${a.note}"` : (WHAT[a.kind] ?? a.kind)}. ${""", """        const what = a.note
          ? a.origin === 'USER'
            ? `Your reminder: "${a.note}"`
            : a.note
          : (WHAT[a.kind] ?? a.kind);
        const body = `${c.number}${req ? ` ${req.title}` : ''}: ${what}. ${""")

rep("""        for (const userId of recipients) {
          await tx.insert(notification).values({
            tenantId: c.tenantId,
            userId,
            title: `Contract alert: ${a.kind.toLowerCase()}`,
            body,
            link: `/app/contracts/${c.id}`,
          });
          await tx.insert(alertDelivery).values([
            {
              tenantId: c.tenantId,
              alertId: a.id,
              userId,
              channel: 'IN_APP',
              status: 'DELIVERED',
              deliveredAt: now,
            },
            // No mail server in the proof of concept: the email is recorded as simulated (docs/swap-points.md).
            {
              tenantId: c.tenantId,
              alertId: a.id,
              userId,
              channel: 'EMAIL',
              status: 'SIMULATED',
              deliveredAt: now,
            },
          ]);
        }""", """        // the fixed alerts cannot be muted (FR-0510); the others follow each person's preferences
        const mandatory = (MANDATORY_KINDS as readonly string[]).includes(a.kind);
        const prefs = mandatory
          ? []
          : await tx.select().from(alertPreference).where(inArray(alertPreference.userId, recipients));
        const channels = (
          a.origin === 'SYSTEM' ? ['IN_APP', 'EMAIL'] : ((a.channels as string[] | null) ?? ['IN_APP'])
        ).filter((ch): ch is 'IN_APP' | 'EMAIL' | 'SMS' | 'SLACK' =>
          ['IN_APP', 'EMAIL', 'SMS', 'SLACK'].includes(ch),
        );
        let muted = 0;
        for (const userId of recipients) {
          if (!mandatory && ((prefs.find((x) => x.userId === userId)?.muted as string[] | undefined) ?? []).includes(a.kind)) {
            muted += 1;
            continue;
          }
          if (channels.includes('IN_APP'))
            await tx.insert(notification).values({
              tenantId: c.tenantId,
              userId,
              title: `Contract alert: ${a.kind.toLowerCase()}`,
              body,
              link: `/app/contracts/${c.id}`,
            });
          // No mail, text or chat service in the proof of concept: those channels are recorded as simulated (docs/swap-points.md).
          for (const channel of channels)
            await tx.insert(alertDelivery).values({
              tenantId: c.tenantId,
              alertId: a.id,
              userId,
              channel,
              status: channel === 'IN_APP' ? 'DELIVERED' : 'SIMULATED',
              deliveredAt: now,
            });
        }""")
rep("""          after: { alertId: a.id, kind: a.kind, triggerDate: a.triggerDate, recipients: recipients.length },""", """          after: {
            alertId: a.id,
            kind: a.kind,
            triggerDate: a.triggerDate,
            recipients: recipients.length,
            muted,
            channels,
          },""")

rep("""    if (a.origin === 'USER' && a.createdBy) {
      const out = new Set<string>([a.createdBy]);""", """    if ((a.origin === 'USER' || a.origin === 'AI') && a.createdBy) {
      const out = new Set<string>([a.createdBy]);
      if (a.ownerId) out.add(a.ownerId);
      if (a.origin === 'AI') for (const o of await this.ownerRecipients(tx, c)) out.add(o);""")
open(p, 'w', encoding='utf8').write(s)
print('ok')
