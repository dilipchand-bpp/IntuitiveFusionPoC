'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Td, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

interface Item {
  itemId: string;
  sku: string;
  name: string;
  category: string;
  supplierId: string;
  supplier: string;
  unit: string;
  unitPrice: number;
  leadDays: number;
  standing: number;
  orderable: boolean;
  notOrderableBecause: string | null;
  fromContract: boolean;
}
interface Catalogue {
  categories: string[];
  items: Item[];
}
interface Scored {
  itemId: string;
  sku: string;
  name: string;
  supplier: string;
  unit: string;
  unitPrice: number;
  leadDays: number;
  total: number;
  score: number;
  breakdown: { price: number; standing: number; delivery: number };
  why: string[];
}
interface Proposal {
  id: string;
  need: string;
  quantity: number;
  status: string;
  shortlist: Scored[];
  recommendedItemId: string | null;
  total: number | null;
  requestId: string | null;
  withinLimit: boolean | null;
  limit: number;
  model: string;
  modelLabel?: string;
  modelSimulated?: boolean;
  /** Written by the tenant's active AI model (NFR-C01). */
  summary?: string;
  summaryNote?: string;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'error' | 'info'> = {
  PROPOSED: 'info',
  ORDERED: 'success',
  REJECTED: 'neutral',
  NO_MATCH: 'warning',
};
const STATUS_TEXT: Record<string, string> = {
  PROPOSED: 'Waiting for your decision',
  ORDERED: 'Draft request created',
  REJECTED: 'Rejected',
  NO_MATCH: 'Nothing matched',
};

export function BuyingView({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const [tab, setTab] = useState<'catalogue' | 'describe'>('catalogue');
  const procurement = has(roles, 'PROCUREMENT');
  return (
    <div className="flex flex-col gap-6">
      <div
        role="note"
        className="rounded-lg border border-info bg-info-bg p-4 text-sm text-text"
        data-testid="buy-notice"
      >
        <strong>Nothing is ordered here.</strong> Choosing items or approving a recommendation only creates a
        draft request. You look it over and submit it, and the usual budget check and approvals follow.
      </div>
      <div role="tablist" aria-label="Ways to buy" className="flex flex-wrap gap-2">
        {(
          [
            ['catalogue', 'Approved catalogue'],
            ['describe', 'Describe what you need'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            onClick={() => setTab(k)}
            className={`min-h-[44px] rounded-md border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              tab === k
                ? 'border-accent bg-accent text-white'
                : 'border-border-strong bg-surface text-text hover:bg-surface-alt'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-catalogue" aria-labelledby="tab-catalogue" hidden={tab !== 'catalogue'}>
        {tab === 'catalogue' && <CataloguePanel csrf={csrf} procurement={procurement} />}
      </div>
      <div role="tabpanel" id="panel-describe" aria-labelledby="tab-describe" hidden={tab !== 'describe'}>
        {tab === 'describe' && <DescribePanel csrf={csrf} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ catalogue
function CataloguePanel({ csrf, procurement }: { csrf: string; procurement: boolean }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [applied, setApplied] = useState({ q: '', category: '' });
  const qs = new URLSearchParams();
  if (applied.q) qs.set('q', applied.q);
  if (applied.category) qs.set('category', applied.category);
  const { data, error, reload } = useData<Catalogue>(`/catalogue${qs.size ? `?${qs}` : ''}`);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [bu, setBu] = useState('Facilities');
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<{ requestId: string; total: number } | null>(null);
  const r = useRun();

  const lines = (data?.items ?? [])
    .map((i) => ({ i, n: Number(qty[i.itemId] ?? 0) }))
    .filter((x) => x.n > 0 && x.i.orderable);
  const basketTotal = lines.reduce((n, l) => n + l.n * l.i.unitPrice, 0);

  async function create() {
    await r.run('order', async () => {
      const out = await send<{ requestId: string; total: number }>(csrf, 'POST', '/buying/orders', {
        lines: lines.map((l) => ({ itemId: l.i.itemId, qty: l.n })),
        businessUnit: bu.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setCreated(out);
      setQty({});
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="grid items-end gap-3 sm:grid-cols-[1fr_14rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ q: q.trim(), category });
        }}
        role="search"
        aria-label="Search the catalogue"
      >
        <Field label="Search the catalogue" hint="A word from the item name, category or code.">
          <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm text-text-muted">Loading…</p>}
      {data && data.items.length === 0 && (
        <EmptyState title="No items found" body="Try another word, or choose all categories." />
      )}
      {data && data.items.length > 0 && (
        <Table caption="Approved catalogue" data-testid="catalogue">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Supplier</Th>
              <Th>Price</Th>
              <Th>Delivery</Th>
              <Th>Quantity</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.itemId} className={i.orderable ? '' : 'bg-surface-alt'} data-testid="catalogue-row">
                <Td label="Item">
                  <span className="font-semibold">{i.name}</span>
                  <br />
                  <span className="text-xs text-text-muted">
                    <span className="font-mono">{i.sku}</span> · {i.category}
                  </span>
                  {i.fromContract && (
                    <>
                      {' '}
                      <Badge tone="info">Contract price</Badge>
                    </>
                  )}
                </Td>
                <Td label="Supplier">
                  {i.supplier}
                  {!i.orderable && (
                    <p className="mt-1 text-xs font-semibold text-error">
                      Cannot be ordered: {i.notOrderableBecause}
                    </p>
                  )}
                </Td>
                <Td label="Price">
                  {money.format(i.unitPrice)} per {i.unit}
                </Td>
                <Td label="Delivery">{i.leadDays === 0 ? 'Ships at once' : `${i.leadDays} days`}</Td>
                <Td label="Quantity">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    aria-label={`Quantity of ${i.name} from ${i.supplier}`}
                    className="w-24"
                    disabled={!i.orderable}
                    value={qty[i.itemId] ?? ''}
                    onChange={(e) => setQty({ ...qty, [i.itemId]: e.target.value })}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Card>
        <h2 className="text-lg font-bold">Your basket</h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Enter a quantity against an item to add it.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm" aria-label="Basket lines">
            {lines.map((l) => (
              <li key={l.i.itemId} className="flex justify-between gap-3 py-1.5">
                <span>
                  {l.n} × {l.i.name} ({l.i.supplier})
                </span>
                <span className="font-semibold">{money.format(l.n * l.i.unitPrice)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 py-1.5 font-bold">
              <span>Total</span>
              <span>{money.format(basketTotal)}</span>
            </li>
          </ul>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Business unit" required>
            <Input value={bu} onChange={(e) => setBu(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Reason (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </div>
        <div className="mt-4">
          <Button
            type="button"
            loading={r.busy === 'order'}
            disabled={lines.length === 0 || !bu.trim() || r.busy !== null}
            onClick={() => void create()}
          >
            Create draft request
          </Button>
        </div>
        {r.messages}
        {created && (
          <p role="status" className="mt-2 text-sm font-medium text-success">
            Draft created for {money.format(created.total)}.{' '}
            <Link href={`/app/requests/${created.requestId}`}>Open the draft to check and submit it</Link>.
          </p>
        )}
      </Card>

      {procurement && <ManageItems csrf={csrf} items={data?.items ?? []} onChange={reload} />}
    </div>
  );
}

function ManageItems({
  csrf,
  items,
  onChange,
}: {
  csrf: string;
  items: Item[];
  onChange: () => Promise<void>;
}) {
  const r = useRun();
  const sup = useData<Array<{ id: string; company: string }>>('/suppliers');
  const [f, setF] = useState({
    supplierId: '',
    sku: '',
    name: '',
    category: '',
    unit: 'each',
    unitPrice: '',
    leadDays: '0',
  });
  const [pick, setPick] = useState('');
  const [price, setPrice] = useState('');
  const [lead, setLead] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const suppliers = Array.isArray(sup.data) ? sup.data : [];
  return (
    <Card data-testid="manage-catalogue">
      <h2 className="text-lg font-bold">Manage the catalogue</h2>
      <p className="mt-1 text-sm text-text-muted">
        Procurement only. Items from a supplier on hold cannot be ordered.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Add a catalogue item"
        onSubmit={(e) => {
          e.preventDefault();
          void r.run(
            'add',
            async () => {
              await send(csrf, 'POST', '/catalogue', {
                supplierId: f.supplierId,
                sku: f.sku.trim(),
                name: f.name.trim(),
                category: f.category.trim(),
                unit: f.unit.trim() || 'each',
                unitPrice: Number(f.unitPrice),
                leadDays: Number(f.leadDays || 0),
              });
              setF({ ...f, sku: '', name: '', unitPrice: '' });
              await onChange();
            },
            'Item added.',
          );
        }}
      >
        <Field label="Supplier" required>
          <Select value={f.supplierId} onChange={set('supplierId')}>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Item code" required>
          <Input value={f.sku} onChange={set('sku')} maxLength={40} />
        </Field>
        <Field label="Item name" required>
          <Input value={f.name} onChange={set('name')} maxLength={160} />
        </Field>
        <Field label="Category" required>
          <Input value={f.category} onChange={set('category')} maxLength={120} />
        </Field>
        <Field label="Unit">
          <Input value={f.unit} onChange={set('unit')} maxLength={20} />
        </Field>
        <Field label="Unit price (AUD)" required>
          <Input type="number" min={0} step="0.01" value={f.unitPrice} onChange={set('unitPrice')} />
        </Field>
        <Field label="Days to deliver">
          <Input type="number" min={0} step={1} value={f.leadDays} onChange={set('leadDays')} />
        </Field>
        <div className="flex items-end">
          <Button
            type="submit"
            loading={r.busy === 'add'}
            disabled={
              !f.supplierId ||
              !f.sku.trim() ||
              !f.name.trim() ||
              !f.category.trim() ||
              f.unitPrice === '' ||
              r.busy !== null
            }
          >
            Add item
          </Button>
        </div>
      </form>

      <form
        className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Update a catalogue item"
        onSubmit={(e) => {
          e.preventDefault();
          void r.run(
            'upd',
            async () => {
              await send(csrf, 'PATCH', `/catalogue/${pick}`, {
                ...(price !== '' ? { unitPrice: Number(price) } : {}),
                ...(lead !== '' ? { leadDays: Number(lead) } : {}),
              });
              setPrice('');
              setLead('');
              await onChange();
            },
            'Item updated.',
          );
        }}
      >
        <Field label="Item to update">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose an item</option>
            {items.map((i) => (
              <option key={i.itemId} value={i.itemId}>
                {i.name} ({i.supplier})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="New unit price">
          <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="New days to deliver">
          <Input type="number" min={0} step={1} value={lead} onChange={(e) => setLead(e.target.value)} />
        </Field>
        <div className="flex items-end gap-2">
          <Button
            type="submit"
            variant="secondary"
            loading={r.busy === 'upd'}
            disabled={!pick || (price === '' && lead === '') || r.busy !== null}
          >
            Update item
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!pick || r.busy !== null}
            onClick={() =>
              void r.run(
                'off',
                async () => {
                  await send(csrf, 'PATCH', `/catalogue/${pick}`, { active: false });
                  setPick('');
                  await onChange();
                },
                'Item removed from the catalogue.',
              )
            }
          >
            Remove
          </Button>
        </div>
      </form>
      {r.messages}
    </Card>
  );
}

// ------------------------------------------------------------------ describe a need
function DescribePanel({ csrf }: { csrf: string }) {
  const [need, setNeed] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [bu, setBu] = useState('Facilities');
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [pickId, setPickId] = useState<string | null>(null);
  const r = useRun();
  const list = useData<Proposal[]>('/buying/proposals');

  const shown = current;
  const chosen = pickId ?? shown?.recommendedItemId ?? null;

  async function find() {
    await r.run('find', async () => {
      const p = await send<Proposal>(csrf, 'POST', '/buying/auto-source', {
        need: need.trim(),
        quantity: Number(quantity),
      });
      setCurrent(p);
      setPickId(null);
      await list.reload();
    });
  }
  async function decide(p: Proposal, decision: 'APPROVE' | 'REJECT') {
    await r.run(
      `d-${p.id}-${decision}`,
      async () => {
        const out = await send<Proposal>(csrf, 'POST', `/buying/proposals/${p.id}/decision`, {
          decision,
          ...(decision === 'APPROVE' ? { itemId: chosen ?? undefined, businessUnit: bu.trim() } : {}),
        });
        setCurrent(out);
        await list.reload();
      },
      decision === 'APPROVE'
        ? 'Approved. A draft request was created: nothing has been ordered.'
        : 'Rejected. Nothing was drafted or ordered.',
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <form
          className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_auto]"
          aria-label="Describe what you need"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <Field
            label="What do you need?"
            hint="For example: A4 recycled copy paper, or ergonomic keyboards."
          >
            <Input value={need} onChange={(e) => setNeed(e.target.value)} maxLength={300} />
          </Field>
          <Field label="Quantity">
            <Input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            loading={r.busy === 'find'}
            disabled={need.trim().length < 3 || !(Number(quantity) > 0) || r.busy !== null}
          >
            Find options
          </Button>
        </form>
        <p className="mt-3 text-xs text-text-muted">
          Options are shortlisted and scored by fixed rules: price 50%, supplier standing 30%, delivery 20%.
          The recommendation wording comes from the organisation's active AI model
          {shown ? ` (${shown.model}, simulated)` : ''}, which an administrator can change.
        </p>
        {r.messages}
      </Card>

      {shown && (
        <section aria-labelledby="short-h" className="flex flex-col gap-4" data-testid="shortlist">
          <h2 id="short-h" className="text-xl font-bold">
            Shortlist for “{shown.need}” (quantity {shown.quantity})
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={STATUS_TONE[shown.status] ?? 'neutral'}>
              {STATUS_TEXT[shown.status] ?? shown.status}
            </Badge>
            <Badge tone="info">Simulated: {shown.model}</Badge>
            {shown.total !== null && shown.withinLimit !== null && (
              <Badge tone={shown.withinLimit ? 'success' : 'error'}>
                {shown.withinLimit
                  ? `Recommended total ${money.format(shown.total)} is within the ${money.format(shown.limit)} limit`
                  : `Recommended total ${money.format(shown.total)} is over the ${money.format(shown.limit)} limit`}
              </Badge>
            )}
          </div>
          {shown.summary && (
            <p
              className="rounded-lg border border-border bg-surface-alt p-3 text-sm"
              data-testid="proposal-summary"
            >
              {shown.summary}
              {shown.summaryNote && <span className="mt-1 block text-text-muted">{shown.summaryNote}</span>}
              <span className="mt-1 block text-xs text-text-muted">
                Written by <strong data-testid="proposal-model">{shown.model}</strong>
                {shown.modelSimulated !== false ? ' (simulated model)' : ''}. A person still decides.
              </span>
            </p>
          )}
          {shown.shortlist.length === 0 ? (
            <EmptyState
              title="Nothing in the catalogue matches"
              body="Try other words, or raise a full request so procurement can source it."
            />
          ) : (
            <ul className="grid gap-4 lg:grid-cols-3">
              {shown.shortlist.map((s, k) => (
                <li key={s.itemId} className="rounded-lg border border-border bg-surface p-4">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {k === 0 && <Badge tone="success">Recommended</Badge>}
                    {s.name}
                  </p>
                  <p className="text-sm text-text-muted">
                    {s.supplier} · <span className="font-mono">{s.sku}</span>
                  </p>
                  <p className="mt-2 text-sm">
                    {money.format(s.unitPrice)} per {s.unit}; total <strong>{money.format(s.total)}</strong>
                  </p>
                  <p className="mt-1 text-sm">
                    Score <strong>{s.score}</strong> out of 100
                  </p>
                  <dl className="mt-1 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-md bg-surface-alt p-2">
                      <dt className="text-text-muted">Price</dt>
                      <dd className="font-bold">{s.breakdown.price}</dd>
                    </div>
                    <div className="rounded-md bg-surface-alt p-2">
                      <dt className="text-text-muted">Standing</dt>
                      <dd className="font-bold">{s.breakdown.standing}</dd>
                    </div>
                    <div className="rounded-md bg-surface-alt p-2">
                      <dt className="text-text-muted">Delivery</dt>
                      <dd className="font-bold">{s.breakdown.delivery}</dd>
                    </div>
                  </dl>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {s.why.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  {shown.status === 'PROPOSED' && (
                    <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm font-semibold">
                      <input
                        type="radio"
                        name={`pick-${shown.id}`}
                        className="size-5 accent-[var(--if-color-accent)]"
                        checked={chosen === s.itemId}
                        onChange={() => setPickId(s.itemId)}
                      />
                      Choose this one
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
          {shown.status === 'PROPOSED' && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <Field label="Business unit" required>
                <Input
                  value={bu}
                  onChange={(e) => setBu(e.target.value)}
                  maxLength={100}
                  className="max-w-xs"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  loading={r.busy === `d-${shown.id}-APPROVE`}
                  disabled={!chosen || !bu.trim() || r.busy !== null}
                  onClick={() => void decide(shown, 'APPROVE')}
                >
                  Approve and draft a request
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={r.busy !== null}
                  onClick={() => void decide(shown, 'REJECT')}
                >
                  Reject
                </Button>
              </div>
              <p className="text-xs text-text-muted">
                Approving only drafts a request for the usual checks. Nothing is ordered or paid. A purchase
                over the limit is refused and needs a full request.
              </p>
            </div>
          )}
          {shown.status === 'ORDERED' && shown.requestId && (
            <p className="text-sm">
              <Link href={`/app/requests/${shown.requestId}`}>Open the draft request</Link> to check and
              submit it.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="prev-h">
        <h2 id="prev-h" className="mb-2 text-xl font-bold">
          Previous proposals
        </h2>
        {list.error && (
          <p role="alert" className="text-sm text-error">
            {list.error}
          </p>
        )}
        {list.data && list.data.length === 0 && (
          <EmptyState
            title="No proposals yet"
            body="Describe what you need above to get a first shortlist."
          />
        )}
        {list.data && list.data.length > 0 && (
          <Table caption="Previous proposals">
            <thead>
              <tr>
                <Th>Need</Th>
                <Th>Quantity</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <Td label="Need">{p.need}</Td>
                  <Td label="Quantity">{p.quantity}</Td>
                  <Td label="Total">{p.total === null ? 'None' : money.format(p.total)}</Td>
                  <Td label="Status">
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>
                      {STATUS_TEXT[p.status] ?? p.status}
                    </Badge>
                    {p.requestId && (
                      <>
                        {' '}
                        <Link href={`/app/requests/${p.requestId}`}>Draft</Link>
                      </>
                    )}
                  </Td>
                  <Td label="Date">{new Date(p.createdAt).toLocaleDateString('en-AU')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
