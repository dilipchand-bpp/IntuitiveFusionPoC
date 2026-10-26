import { describe, expect, it } from 'vitest';
import {
  FIRST_LOOK_BACK_MS,
  LAST_VISIT_KEY,
  actionRow,
  auditLines,
  dayPart,
  firstName,
  greeting,
  humaniseAction,
  longDate,
  matchesQuery,
  procurementLines,
  procurementRow,
  readLastVisit,
  sinceLines,
  sinceSummary,
  writeLastVisit,
} from './home';

describe('greeting', () => {
  it('follows the hour of the day', () => {
    expect(dayPart(0)).toBe('morning');
    expect(dayPart(11)).toBe('morning');
    expect(dayPart(12)).toBe('afternoon');
    expect(dayPart(17)).toBe('afternoon');
    expect(dayPart(18)).toBe('evening');
    expect(dayPart(23)).toBe('evening');
  });
  it('uses the first name from the session', () => {
    expect(firstName('Alex Lee')).toBe('Alex');
    expect(firstName('  Riley  ')).toBe('Riley');
    expect(greeting('Alex Lee', 9)).toBe('Good morning, Alex.');
    expect(greeting('', 15)).toBe('Good afternoon.');
  });
  it('formats the date as weekday, day and month', () => {
    expect(longDate(new Date(2026, 9, 27))).toBe('Tuesday 27 October');
  });
});

describe('work queue rows', () => {
  it('an overdue action gets a warm bar and an Overdue tag; a plain one a cool bar and no tag', () => {
    const late = actionRow({
      key: 'grc:1',
      kind: 'Overdue in the register',
      title: 'Quarterly review',
      detail: 'Was due 2026-10-01',
      link: '/app/risk',
    });
    expect(late).toMatchObject({
      accent: 'warning',
      tag: 'Overdue',
      href: '/app/risk',
      caption: 'Overdue in the register',
    });
    const plain = actionRow({
      key: 'a',
      kind: 'Plan to approve',
      title: 'T',
      detail: 'D',
      link: '/app/plans/1',
    });
    expect(plain.accent).toBe('info');
    expect(plain.tag).toBeUndefined();
  });
  it('a blocked invoice is flagged as blocked', () => {
    expect(
      actionRow({ key: 'i', kind: 'Invoice blocked', title: 'Invoice 1', detail: 'Stopped', link: '/x' }).tag,
    ).toBe('Blocked');
  });
  it('procurement rows carry the phase and number, and no link when the role cannot open requests', () => {
    const r = procurementRow(
      {
        id: '1',
        number: 'PR-1',
        title: 'Cleaning',
        phase: 'TENDER',
        status: 'IN_PROGRESS',
        estimatedValue: 5,
      },
      (p) => p.toLowerCase(),
      null,
    );
    expect(r).toMatchObject({ caption: 'Procurement · tender', subtitle: 'PR-1', href: '' });
  });
  it('the search matches caption, title and subtitle, ignoring case and spaces at the ends', () => {
    const r = actionRow({
      key: 'a',
      kind: 'Contract',
      title: 'Quarterly service review',
      detail: 'Energy supply',
      link: '/x',
    });
    expect(matchesQuery(r, '  ENERGY ')).toBe(true);
    expect(matchesQuery(r, 'contract')).toBe(true);
    expect(matchesQuery(r, 'zzz')).toBe(false);
    expect(matchesQuery(r, '')).toBe(true);
  });
});

describe('recent activity', () => {
  it('turns audit actions into plain words and drops sign-in noise and failures', () => {
    expect(humaniseAction('plan.decision')).toBe('Plan decision');
    const lines = auditLines(
      [
        {
          seq: 3,
          at: '2026-10-26T01:00:00Z',
          actorName: 'Sam Khan',
          action: 'plan.decision',
          entityType: 'plan',
          result: 'SUCCESS',
        },
        {
          seq: 2,
          at: '2026-10-26T00:00:00Z',
          actorName: 'Sam Khan',
          action: 'auth.login',
          entityType: 'session',
          result: 'SUCCESS',
        },
        {
          seq: 1,
          at: '2026-10-25T00:00:00Z',
          actorName: null,
          action: 'x.y',
          entityType: 'z',
          result: 'DENIED',
        },
      ],
      10,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ who: 'Sam Khan', text: 'Plan decision (plan)' });
    expect(lines[0]!.meta).toContain('Sam Khan');
  });
  it('falls back to the procurements a person can see, newest first, linking only when allowed', () => {
    const rows = [
      {
        id: 'a',
        number: 'PR-1',
        title: 'Old',
        phase: 'PLAN',
        status: 'DRAFT',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'b',
        number: 'PR-2',
        title: 'New',
        phase: 'TENDER',
        status: 'DRAFT',
        updatedAt: '2026-10-20T00:00:00Z',
      },
    ];
    const lines = procurementLines(
      rows,
      (p) => p,
      (id) => (id === 'b' ? '/app/requests/b' : undefined),
      5,
    );
    expect(lines.map((l) => l.key)).toEqual(['proc:b', 'proc:a']);
    expect(lines[0]!.href).toBe('/app/requests/b');
    expect(lines[1]!.href).toBeUndefined();
  });
});

describe('since you were last here', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const notes = [
    {
      id: '1',
      title: 'Draft contract ready',
      body: 'Review it',
      link: '/app/contracts/1',
      createdAt: '2026-10-26T10:00:00Z',
    },
    { id: '2', title: 'Old news', createdAt: '2026-10-01T10:00:00Z' },
  ];
  const activity = [{ key: 'a', who: 'Sam', text: 'Approved', meta: 'Sam', at: '2026-10-26T20:00:00Z' }];
  it('keeps only what is newer than the last visit, newest first, across both sources', () => {
    const l = sinceLines('2026-10-25T00:00:00Z', now, { notes, activity });
    expect(l.map((x) => x.key)).toEqual(['a', 'note:1']);
    expect(l[1]!.href).toBe('/app/contracts/1');
  });
  it('with no stored visit it looks back a week', () => {
    expect(FIRST_LOOK_BACK_MS).toBe(7 * 86_400_000);
    expect(sinceLines(null, now, { notes, activity }).map((x) => x.key)).toEqual(['a', 'note:1']);
  });
  it('says so calmly when nothing is new', () => {
    expect(sinceSummary(0, '2026-10-25T00:00:00Z')).toBe('Nothing new since 25 Oct 2026.');
    expect(sinceSummary(0, null)).toBe('Nothing new in the last week.');
    expect(sinceSummary(1, null)).toBe('1 update in the last week.');
    expect(sinceSummary(2, '2026-10-25T00:00:00Z')).toBe('2 updates since 25 Oct 2026.');
  });
  it('the last visit is never required: blocked or broken storage reads as "no visit" and writes quietly fail', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLastVisit(throwing)).toBeNull();
    expect(() => writeLastVisit(throwing, now)).not.toThrow();
    expect(readLastVisit(null)).toBeNull();
    expect(readLastVisit({ getItem: () => 'not a date' })).toBeNull();
  });
  it('round-trips through storage', () => {
    const mem = new Map<string, string>();
    const s = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    writeLastVisit(s, now);
    expect(mem.get(LAST_VISIT_KEY)).toBe(now.toISOString());
    expect(readLastVisit(s)).toBe(now.toISOString());
  });
});
