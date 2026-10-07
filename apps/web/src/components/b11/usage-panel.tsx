'use client';
import { Badge, Card, Table, Td, Th } from '@if/ui';
import { Bar, useData } from '@/components/contract/b5-shared';

interface Plan {
  key: string;
  name: string;
  requestsPerMinute: number;
  burst: number;
  dailyRequests: number;
  monthlyAiCalls: number;
  storageMb: number;
  maxUsers: number;
}
interface Usage {
  plan: Plan;
  today: { day: string; requests: number; throttled: number; aiCalls: number; requestsRemaining: number };
  month: { month: string; requests: number; throttled: number; aiCalls: number; aiCallsRemaining: number };
  bucket: { tokens: number; capacity: number; refillPerSecond: number };
  storage: { usedBytes: number; usedMb: number; limitMb: number; estimate: boolean };
  users: { active: number; max: number };
  recent: Array<{ day: string; requests: number; throttled: number; aiCalls: number }>;
  plans: Array<Plan & { current: boolean }>;
  note: string;
}
const n = (v: number) => v.toLocaleString('en-AU');
const pct = (used: number, limit: number) => (limit > 0 ? (used / limit) * 100 : 0);

/** The organisation's usage plan, its limits and what has been used today (NFR-SC01). */
export function UsagePanel() {
  const d = useData<Usage>('/usage');
  if (d.error && !d.data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {d.error}
      </p>
    );
  const u = d.data;
  if (!u) return <p className="text-sm text-text-muted">Loading usage…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="usage-panel">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-xl font-bold">Your plan</h2>
          <Badge tone="info">
            <span data-testid="plan-name">{u.plan.name}</span>
          </Badge>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[
            ['Requests a minute', n(u.plan.requestsPerMinute)],
            ['Burst', n(u.plan.burst)],
            ['Requests a day', n(u.plan.dailyRequests)],
            ['AI calls a month', n(u.plan.monthlyAiCalls)],
            ['Storage', `${n(u.plan.storageMb)} MB`],
            ['Users', n(u.plan.maxUsers)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-surface-alt p-3">
              <dt className="text-xs text-text-muted">{k}</dt>
              <dd className="mt-1 text-lg font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          Every signed-in request from your organisation takes one token from a bucket of{' '}
          {n(u.bucket.capacity)} that refills at {u.bucket.refillPerSecond} a second; {n(u.bucket.tokens)} are
          left now. When it is empty, requests are refused with a 429 and a Retry-After. Another
          organisation&apos;s use never touches yours.
        </p>
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Used today ({u.today.day})</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Bar
            label={`Requests: ${n(u.today.requests)} of ${n(u.plan.dailyRequests)}`}
            pct={pct(u.today.requests, u.plan.dailyRequests)}
          />
          <Bar
            label={`AI calls this month: ${n(u.month.aiCalls)} of ${n(u.plan.monthlyAiCalls)}`}
            pct={pct(u.month.aiCalls, u.plan.monthlyAiCalls)}
          />
          <Bar
            label={`Storage: ${u.storage.usedMb} MB of ${n(u.plan.storageMb)} MB (estimate)`}
            pct={pct(u.storage.usedMb, u.plan.storageMb)}
          />
          <Bar
            label={`Users: ${n(u.users.active)} of ${n(u.plan.maxUsers)}`}
            pct={pct(u.users.active, u.plan.maxUsers)}
          />
        </div>
        <p className="mt-3 text-sm" data-testid="throttled-count">
          Requests refused today because the allowance was used up:{' '}
          <span className="font-bold">{n(u.today.throttled)}</span>
          {u.month.throttled > u.today.throttled ? ` (${n(u.month.throttled)} this month)` : ''}
        </p>
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Last week</h2>
        <Table caption="Requests per day for the last week">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Requests</Th>
              <Th>Refused</Th>
              <Th>AI calls</Th>
            </tr>
          </thead>
          <tbody>
            {u.recent.map((r) => (
              <tr key={r.day}>
                <Td label="Day">{r.day}</Td>
                <Td label="Requests">{n(r.requests)}</Td>
                <Td label="Refused">{n(r.throttled)}</Td>
                <Td label="AI calls">{n(r.aiCalls)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Available plans</h2>
        <Table caption="Usage plans">
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Per minute</Th>
              <Th>Burst</Th>
              <Th>Per day</Th>
              <Th>AI a month</Th>
              <Th>Storage</Th>
              <Th>Users</Th>
            </tr>
          </thead>
          <tbody>
            {u.plans.map((p) => (
              <tr key={p.key}>
                <Td label="Plan">
                  {p.name} {p.current && <Badge tone="info">Current</Badge>}
                </Td>
                <Td label="Per minute">{n(p.requestsPerMinute)}</Td>
                <Td label="Burst">{n(p.burst)}</Td>
                <Td label="Per day">{n(p.dailyRequests)}</Td>
                <Td label="AI a month">{n(p.monthlyAiCalls)}</Td>
                <Td label="Storage">{n(p.storageMb)} MB</Td>
                <Td label="Users">{n(p.maxUsers)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-text-muted">{u.note}</p>
      </Card>
    </div>
  );
}
