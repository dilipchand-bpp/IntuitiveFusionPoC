import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, defaultMilestones, scheduleAlerts, termBars } from './dates.js';

describe('date arithmetic', () => {
  it('adds months with month-end clamping and leap years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
  });
  it('adds days across month ends and leap days, and counts them', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0);
  });
});

describe('alert schedule (US-CMG-02)', () => {
  const base = { noticeDays: 90, milestones: [], extensions: [] as number[] };
  it('a 90-day notice period schedules the notice alert 150 days before the end date', () => {
    const a = scheduleAlerts({ ...base, endDate: '2027-06-30' }, '2026-10-01');
    expect(a.find((x) => x.kind === 'NOTICE')!.triggerDate).toBe(addDays('2027-06-30', -150));
    expect(a.find((x) => x.kind === 'NOTICE')!.triggerDate).toBe('2027-01-31');
    expect(a.find((x) => x.kind === 'EXPIRY')!.triggerDate).toBe('2027-05-01');
  });
  it('the notice alert follows the notice period, including across a leap day', () => {
    expect(
      scheduleAlerts({ ...base, noticeDays: 60, endDate: '2028-03-31' }, '2026-01-01')[0]!.triggerDate,
    ).toBe('2027-12-02');
    expect(
      scheduleAlerts({ ...base, noticeDays: 90, endDate: '2028-06-30' }, '2026-01-01')[0]!.triggerDate,
    ).toBe('2028-02-01');
  });
  it('schedules extension and milestone reminders; drops those already past but keeps notice and expiry', () => {
    const input = {
      endDate: '2027-06-30',
      noticeDays: 90,
      extensions: [12],
      milestones: [
        { title: 'Old', dueDate: '2026-01-10' },
        { title: 'Review', dueDate: '2026-12-01' },
      ],
    };
    const a = scheduleAlerts(input, '2026-10-01');
    expect(a.map((x) => x.kind)).toEqual(['MILESTONE', 'NOTICE', 'EXTENSION', 'EXPIRY']);
    expect(a.find((x) => x.kind === 'MILESTONE')!.triggerDate).toBe('2026-11-17');
    const late = scheduleAlerts(input, '2027-06-01');
    expect(late.map((x) => x.kind).sort()).toEqual(['EXPIRY', 'NOTICE']); // overdue but still raised
  });
  it('never schedules two alerts of one kind on one day', () => {
    const a = scheduleAlerts(
      {
        ...base,
        endDate: '2027-06-30',
        milestones: [
          { title: 'A', dueDate: '2026-12-01' },
          { title: 'B', dueDate: '2026-12-01' },
        ],
      },
      '2026-10-01',
    );
    expect(a.filter((x) => x.kind === 'MILESTONE')).toHaveLength(1);
  });
});

describe('record defaults and the Gantt bars', () => {
  it('starts every record with commencement and a mid-term review', () => {
    expect(defaultMilestones('2026-01-01', '2027-01-01')).toEqual([
      { title: 'Commencement', dueDate: '2026-01-01' },
      { title: 'Mid-term review', dueDate: '2026-07-02' },
    ]);
  });
  it('lays optional extensions end to end after the initial term', () => {
    expect(termBars('2026-02-01', '2028-01-31', [12, 6])).toEqual([
      { label: 'Initial term', start: '2026-02-01', end: '2028-01-31', optional: false },
      { label: 'Option 1 (12 months)', start: '2028-01-31', end: '2029-01-31', optional: true },
      { label: 'Option 2 (6 months)', start: '2029-01-31', end: '2029-07-31', optional: true },
    ]);
  });
});
