'use client';
import type { ReactNode } from 'react';
import { Badge, Card } from '@if/ui';
import { useData } from '@/components/contract/b5-shared';

interface Option {
  id: 'PLATFORM_SAAS' | 'CUSTOMER_CLOUD' | 'HYBRID';
  name: string;
  summary: string;
  flows: string[];
  platformResponsible: string[];
  customerResponsible: string[];
  residency: string;
  keyManagement: string;
  suits: string;
  tradeOffs: string[];
}
interface View {
  label: string;
  note: string;
  options: Option[];
}

const BOX = {
  fill: 'var(--if-color-surface-alt)',
  stroke: 'var(--if-color-border-strong)',
  strokeWidth: 1.5,
} as const;
const ZONE = {
  fill: 'none',
  stroke: 'var(--if-color-accent)',
  strokeWidth: 1.5,
  strokeDasharray: '6 4',
} as const;
const TXT = { fill: 'var(--if-color-text)', fontSize: 13, fontFamily: 'inherit' } as const;
const MUTED = { fill: 'var(--if-color-text-muted)', fontSize: 11, fontFamily: 'inherit' } as const;
const ARROW = {
  stroke: 'var(--if-color-text)',
  strokeWidth: 1.5,
  fill: 'none',
  markerEnd: 'url(#arrow)',
} as const;

function Node({
  x,
  y,
  w = 130,
  h = 44,
  title,
  sub,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  sub?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} {...BOX} />
      <text x={x + w / 2} y={y + (sub ? 19 : 26)} textAnchor="middle" {...TXT}>
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + 35} textAnchor="middle" {...MUTED}>
          {sub}
        </text>
      )}
    </g>
  );
}
function Zone({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} {...ZONE} />
      <text x={x + 10} y={y + 17} {...MUTED}>
        {label}
      </text>
    </g>
  );
}
function Line({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} {...ARROW} />
      {label && (
        <text x={lx} y={ly} textAnchor="middle" {...MUTED}>
          {label}
        </text>
      )}
    </g>
  );
}

function Frame({
  id,
  title,
  desc,
  children,
}: {
  id: string;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 720 300"
      role="img"
      aria-labelledby={`${id}-t ${id}-d`}
      className="h-auto w-full max-w-3xl rounded-lg border border-border bg-surface"
    >
      <title id={`${id}-t`}>{title}</title>
      <desc id={`${id}-d`}>{desc}</desc>
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--if-color-text)" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

function Diagram({ o }: { o: Option }) {
  const id = `topo-${o.id}`;
  const desc = `Data flows: ${o.flows.join(' ')}`;
  if (o.id === 'PLATFORM_SAAS')
    return (
      <Frame id={id} title="Platform-hosted software as a service" desc={desc}>
        <Node x={20} y={120} title="Users" sub="staff and suppliers" w={110} />
        <Zone x={170} y={30} w={330} h={240} label="Platform region (the country the customer elected)" />
        <Node x={190} y={120} title="Application" sub="workflow, AI paths" />
        <Node x={350} y={70} title="Database" sub="per-tenant keys" w={130} />
        <Node x={350} y={170} title="Object storage" sub="bids, documents" w={130} />
        <Node x={560} y={120} title="Customer systems" sub="ERP, HR, legal" w={140} />
        <Line d="M130 142 L190 142" label="HTTPS" lx={160} ly={134} />
        <Line d="M320 132 L350 100" />
        <Line d="M320 152 L350 190" />
        <Line d="M320 142 L560 142" label="signed connectors" lx={440} ly={134} />
      </Frame>
    );
  if (o.id === 'CUSTOMER_CLOUD')
    return (
      <Frame id={id} title="Customer cloud" desc={desc}>
        <Node x={20} y={120} title="Users" sub="through the customer edge" w={110} />
        <Zone
          x={170}
          y={20}
          w={530}
          h={260}
          label="Customer cloud account (the customer's region and keys)"
        />
        <Node x={190} y={120} title="Application" sub="deployed from definitions" />
        <Node x={350} y={60} title="Database" sub="customer keys" w={130} />
        <Node x={350} y={170} title="Object storage" sub="customer keys" w={130} />
        <Node x={540} y={60} title="Key service" sub="customer-owned" w={130} />
        <Node x={540} y={170} title="Customer systems" sub="private network" w={130} />
        <Line d="M130 142 L190 142" label="HTTPS" lx={160} ly={134} />
        <Line d="M320 132 L350 90" />
        <Line d="M320 152 L350 200" />
        <Line d="M480 82 L540 82" label="wrap keys" lx={510} ly={74} />
        <Line d="M320 142 L520 190 L540 192" />
        <text x={190} y={250} {...MUTED}>
          Vendor sees only agreed support telemetry, with no tenant data.
        </text>
      </Frame>
    );
  return (
    <Frame id={id} title="Hybrid hosting" desc={desc}>
      <Node x={20} y={120} title="Users" sub="staff and suppliers" w={110} />
      <Zone x={160} y={20} w={250} h={260} label="Platform region" />
      <Node x={180} y={70} title="Application" sub="workflow data" />
      <Node x={180} y={170} title="Gateway" sub="sensitive data path" />
      <Zone x={440} y={20} w={260} h={260} label="Customer account" />
      <Node x={460} y={70} title="Sensitive store" sub="bids, personal records" w={150} />
      <Node x={460} y={170} title="Key service" sub="customer-owned" w={150} />
      <Line d="M130 142 L180 92" label="HTTPS" lx={140} ly={110} />
      <Line d="M245 114 L245 170" />
      <Line d="M310 192 L460 100" label="writes" lx={400} ly={150} />
      <Line d="M535 114 L535 170" label="wraps keys" lx={575} ly={146} />
    </Frame>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted">{title}</h4>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

/** The three hosting options for SEC-D11. DESIGN ONLY: nothing here is built. */
export function TopologyPanel() {
  const { data, error } = useData<View>('/design/hosting-topology');
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div
        role="note"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-warning bg-warning-bg p-4"
      >
        <Badge tone="warning">{data.label}</Badge>
        <p className="max-w-prose text-sm" data-testid="design-note">
          {data.note}
        </p>
      </div>
      {data.options.map((o) => (
        <Card key={o.id} data-testid={`option-${o.id}`}>
          <h2 className="font-heading text-xl font-bold">{o.name}</h2>
          <p className="mt-1 max-w-prose text-sm text-text-muted">{o.summary}</p>
          <div className="mt-4">
            <Diagram o={o} />
          </div>
          <div className="mt-4">
            <List title="Data flows, in words (the text alternative of the diagram)" items={o.flows} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <List title="The platform is responsible for" items={o.platformResponsible} />
            <List title="The customer is responsible for" items={o.customerResponsible} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">Residency</dt>
              <dd className="mt-1">{o.residency}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">Key management</dt>
              <dd className="mt-1">{o.keyManagement}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">Suits</dt>
              <dd className="mt-1">{o.suits}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <List title="Trade-offs" items={o.tradeOffs} />
          </div>
        </Card>
      ))}
    </div>
  );
}
