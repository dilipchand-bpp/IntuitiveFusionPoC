import { Table, Td, Th } from '@if/ui';

/** One value to draw. `display` is the text shown for it when the plain number would mislead (money, days). */
export interface Point {
  label: string;
  value: number;
  display?: string;
}

/** Must match the style enum the dashboard API accepts. */
export type ChartStyle = 'CARDS' | 'BAR' | 'BAR3D' | 'LINE' | 'DONUT' | 'TABLE';

const PALETTE = [
  'var(--color-accent)',
  'var(--color-secondary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-info)',
  'var(--color-error)',
  'var(--color-primary)',
  'var(--color-silver)',
];
const colour = (i: number) => PALETTE[i % PALETTE.length]!;
const num = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
const show = (p: Point) => p.display ?? num.format(p.value);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The numbers behind a chart, for anyone who cannot see it. */
function HiddenTable({ caption, points }: { caption: string; points: Point[] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={`${p.label}-${i}`}>
              <th scope="row">{p.label}</th>
              <td>{show(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars. */
export function BarChart({ caption, points }: { caption: string; points: Point[] }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  return (
    <div>
      <ul className="flex flex-col gap-3" aria-hidden="true">
        {points.map((p, i) => (
          <li key={`${p.label}-${i}`}>
            <div className="flex min-w-0 justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{p.label}</span>
              <strong className="shrink-0">{show(p)}</strong>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-2.5 rounded-full motion-safe:transition-[width] motion-safe:duration-500"
                style={{
                  width: `${(Math.abs(p.value) / max) * 100}%`,
                  background: p.value < 0 ? 'var(--color-error)' : 'var(--color-accent)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <HiddenTable caption={caption} points={points} />
    </div>
  );
}

/** Columns with a skewed top and side face so they read as solid. */
export function Bar3D({ caption, points }: { caption: string; points: Point[] }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const step = 52;
  const bw = 28;
  const depth = 10;
  const base = 150;
  const full = 115;
  const width = 24 + points.length * step + depth;
  return (
    <div>
      <div className="overflow-x-auto" aria-hidden="true">
        <svg
          viewBox={`0 0 ${width} 176`}
          className="h-auto w-full"
          style={{ minWidth: Math.min(width, 360) }}
        >
          <line x1="10" x2={width - 6} y1={base} y2={base} style={{ stroke: 'var(--color-border-strong)' }} />
          {points.map((p, i) => {
            const h = Math.max(1, (Math.abs(p.value) / max) * full);
            const x = 18 + i * step;
            const y = base - h;
            const c = p.value < 0 ? 'var(--color-error)' : colour(0);
            const rise = depth * 0.6;
            return (
              <g key={`${p.label}-${i}`}>
                <rect x={x} y={y} width={bw} height={h} style={{ fill: c }} />
                <polygon
                  points={`${x},${y} ${x + depth},${y - rise} ${x + bw + depth},${y - rise} ${x + bw},${y}`}
                  style={{ fill: `color-mix(in srgb, ${c} 65%, white)` }}
                />
                <polygon
                  points={`${x + bw},${y} ${x + bw + depth},${y - rise} ${x + bw + depth},${y + h - rise} ${x + bw},${y + h}`}
                  style={{ fill: `color-mix(in srgb, ${c} 60%, black)` }}
                />
                <text
                  x={x + bw / 2 + depth / 2}
                  y={base + 14}
                  textAnchor="middle"
                  fontSize="9"
                  style={{ fill: 'var(--color-text-muted)' }}
                >
                  {short(p.label, 9)}
                </text>
                <text
                  x={x + bw / 2 + depth / 2}
                  y={y - rise - 3}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="600"
                  style={{ fill: 'var(--color-text)' }}
                >
                  {short(show(p), 9)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <HiddenTable caption={caption} points={points} />
    </div>
  );
}

/** A line through the values, in the order given. */
export function LineChart({ caption, points }: { caption: string; points: Point[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 320;
  const h = 150;
  const left = 12;
  const top = 14;
  const bottom = 126;
  const span = Math.max(1, points.length - 1);
  const xy = points.map((p, i) => [
    left + (points.length === 1 ? (w - left * 2) / 2 : (i / span) * (w - left * 2)),
    bottom - (Math.max(0, p.value) / max) * (bottom - top),
  ]);
  return (
    <div>
      <div aria-hidden="true">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full">
          <line
            x1={left}
            x2={w - left}
            y1={bottom}
            y2={bottom}
            style={{ stroke: 'var(--color-border-strong)' }}
          />
          <polyline
            points={xy.map((q) => q.join(',')).join(' ')}
            fill="none"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ stroke: 'var(--color-accent)' }}
          />
          {xy.map((q, i) => (
            <g key={`${points[i]!.label}-${i}`}>
              <circle cx={q[0]} cy={q[1]} r="3.5" style={{ fill: 'var(--color-accent)' }} />
              <text
                x={q[0]}
                y={q[1]! - 7}
                textAnchor="middle"
                fontSize="9"
                style={{ fill: 'var(--color-text)' }}
              >
                {short(show(points[i]!), 8)}
              </text>
              <text
                x={q[0]}
                y={bottom + 14}
                textAnchor="middle"
                fontSize="9"
                style={{ fill: 'var(--color-text-muted)' }}
              >
                {short(points[i]!.label, 9)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <HiddenTable caption={caption} points={points} />
    </div>
  );
}

/** A ring split by share, with a legend. Values of zero or less are left out of the ring. */
export function Donut({ caption, points }: { caption: string; points: Point[] }) {
  const parts = points.filter((p) => p.value > 0);
  const total = parts.reduce((n, p) => n + p.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-5" aria-hidden="true">
        <svg viewBox="0 0 100 100" className="size-36 shrink-0 -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="16"
            style={{ stroke: 'var(--color-surface-alt)' }}
          />
          {parts.map((p, i) => {
            const len = (p.value / total) * c;
            const seg = (
              <circle
                key={`${p.label}-${i}`}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                strokeWidth="16"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-acc}
                style={{ stroke: colour(i) }}
              />
            );
            acc += len;
            return seg;
          })}
        </svg>
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          {parts.map((p, i) => (
            <li key={`${p.label}-${i}`} className="flex min-w-0 items-center gap-2">
              <span className="size-3 shrink-0 rounded-sm" style={{ background: colour(i) }} />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <strong className="shrink-0">
                {show(p)}{' '}
                <span className="font-normal text-text-muted">({Math.round((p.value / total) * 100)}%)</span>
              </strong>
            </li>
          ))}
        </ul>
      </div>
      <HiddenTable caption={caption} points={points} />
    </div>
  );
}

/** One small card per value. */
export function CardsView({ points }: { points: Point[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {points.map((p, i) => (
        <li key={`${p.label}-${i}`} className="min-w-0 rounded-md border border-border bg-surface-alt p-3">
          <p className="text-xs font-semibold text-text-muted">{p.label}</p>
          <p className="mt-1 break-words text-xl font-extrabold">{show(p)}</p>
        </li>
      ))}
    </ul>
  );
}

/** The values as a plain table. */
export function TableView({ caption, points }: { caption: string; points: Point[] }) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th className="text-right">Value</Th>
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => (
          <tr key={`${p.label}-${i}`}>
            <Td label="Name">{p.label}</Td>
            <Td label="Value" className="text-right">
              {show(p)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Draws the points in the chosen style. */
export function ChartView({
  style,
  caption,
  points,
}: {
  style: ChartStyle;
  caption: string;
  points: Point[];
}) {
  if (points.length === 0) return <p className="text-text-muted">Nothing to show yet.</p>;
  switch (style) {
    case 'CARDS':
      return <CardsView points={points} />;
    case 'BAR3D':
      return <Bar3D caption={caption} points={points} />;
    case 'LINE':
      return <LineChart caption={caption} points={points} />;
    case 'DONUT':
      return <Donut caption={caption} points={points} />;
    case 'TABLE':
      return <TableView caption={caption} points={points} />;
    default:
      return <BarChart caption={caption} points={points} />;
  }
}
