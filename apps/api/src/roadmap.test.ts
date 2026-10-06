import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROADMAP, roadmapForArea } from '@if/shared';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Minimal CSV reader (quotes, doubled quotes, newlines inside quotes) for docs/RTM.csv. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const [header, ...body] = parseCsv(read('../../../docs/RTM.csv').replace(String.fromCharCode(0xfeff), ''));
const col = (name: string) => header!.indexOf(name);
const rtm = body.map((r) => ({
  id: r[col('Req ID')]!,
  tier: r[col('POC tier')]!,
  category: r[col('Category')]!,
}));

describe('roadmap register vs the requirements traceability matrix (TODO <-> RTM reconciliation)', () => {
  it('reads the matrix', () => {
    expect(rtm.length).toBe(312);
    expect(new Set(rtm.map((r) => r.id)).size).toBe(312);
  });

  it('every stubbed (S) and deferred (D) requirement appears exactly once, in its own tier, and nothing else does', () => {
    const expected = rtm.filter((r) => r.tier === 'S' || r.tier === 'D');
    expect(ROADMAP.map((i) => i.id).sort()).toEqual(expected.map((r) => r.id).sort());
    const tierOf = new Map(rtm.map((r) => [r.id, r.tier]));
    for (const i of ROADMAP) expect(tierOf.get(i.id), i.id).toBe(i.tier);
  });

  it('every stubbed requirement belongs to a screen; deferred ones to none', () => {
    for (const i of ROADMAP) {
      if (i.tier === 'S') expect(i.area, i.id).toMatch(/^\/(app|admin|supplier)/);
      else expect(i.area, i.id).toBeNull();
      expect(i.title.length, i.id).toBeGreaterThan(5);
    }
  });

  it('every stubbed requirement carries a TODO(id) marker and every deferred one a DEFERRED(id) marker', () => {
    const src = read('../../../packages/shared/src/roadmap-data.ts');
    for (const i of ROADMAP) {
      const marker = i.tier === 'S' ? `TODO(${i.id})` : `DEFERRED(${i.id})`;
      expect(src.includes(marker), marker).toBe(true);
    }
  });

  it('docs/todo-inventory.md lists every requirement (regenerate with _work/gen_roadmap.py when the RTM changes)', () => {
    const md = read('../../../docs/todo-inventory.md');
    for (const i of ROADMAP) expect(md.includes(`| ${i.id} |`), i.id).toBe(true);
  });

  it('screens that show a coming-soon panel list their requirement ids', () => {
    expect(roadmapForArea('/admin/migration').map((i) => i.id)).toEqual(
      expect.arrayContaining(['FR-0655', 'FR-0660', 'FR-0665', 'FR-0670', 'FR-0675']),
    );
    expect(roadmapForArea('/app/collaboration').length).toBeGreaterThan(0);
  });
});

describe('delivered requirements (roadmap batches)', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const testFiles = (dir: string): string[] =>
    (readdirSync(`${root}${dir}`, { recursive: true }) as string[])
      .filter((f) => /\.(test|spec)\.tsx?$/.test(f) && !f.includes('node_modules'))
      .map((f) => readFileSync(`${root}${dir}/${f}`, 'utf8'));
  const allTests = [...testFiles('apps'), ...testFiles('e2e'), ...testFiles('packages')].join('\n');
  const built = ROADMAP.filter((i) => i.status === 'BUILT');

  it('every requirement marked built names the batch that delivered it and is cited by an automated test', () => {
    expect(built.length).toBeGreaterThan(0);
    for (const i of built) {
      expect(['S', 'D'], i.id).toContain(i.tier);
      expect(i.batch, i.id).toMatch(/^B\d+$/);
      expect(
        new RegExp(`(?<![A-Za-z0-9-])${i.id}(?![0-9A-Za-z])`).test(allTests),
        `${i.id} is built but no test cites it`,
      ).toBe(true);
    }
  });

  it('nothing deferred is marked built, and the built list matches delivered.json', () => {
    expect(
      ROADMAP.filter(
        (i) => i.tier === 'D' && i.status !== 'DEFERRED' && i.status !== 'BUILT' && i.status !== 'PARTIAL',
      ),
    ).toEqual([]);
    const file = JSON.parse(readFileSync(`${root}_work/delivered.json`, 'utf8')) as Record<
      string,
      { ids: string[] }
    >;
    const listed = Object.values(file)
      .flatMap((b) => b.ids)
      .sort();
    expect(built.map((i) => i.id).sort()).toEqual(listed);
  });

  it('a partly built requirement says what is and is not built, names its batch, and is cited by an automated test', () => {
    const partial = JSON.parse(readFileSync(`${root}_work/partial.json`, 'utf8')) as Record<
      string,
      { batch: string; note: string }
    >;
    const shown = ROADMAP.filter((i) => i.tier === 'D' && i.status === 'PARTIAL');
    expect(shown.map((i) => i.id).sort()).toEqual(Object.keys(partial).sort());
    for (const i of shown) {
      expect(i.note, i.id).toMatch(/Not built/);
      expect(i.batch, i.id).toMatch(/^B\d+$/);
      expect(
        new RegExp(`(?<![A-Za-z0-9-])${i.id}(?![0-9A-Za-z])`).test(allTests),
        `${i.id} has no test`,
      ).toBe(true);
    }
  });
});
