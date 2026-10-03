/**
 * Synthetic bid documents for the demo data, so the seeded bids have real files that open: a technical response as a PDF
 * and a pricing schedule as an Excel workbook. Everything in them is made up (no real supplier, price or person).
 */
import { renderPdf, type PdfBlock } from '../documents/pdf.js';
import { buildXlsx } from '../documents/xlsx.js';

const APPROACH = [
  'We clean every nominated site on the agreed schedule using a floor-by-floor checklist, signed off by the site supervisor each night.',
  'Our approach is built around a named supervisor per site, a fortnightly audit and a monthly report with photos of any corrective work.',
  'We use a roster that keeps the same team on the same site, which cuts handover errors and builds familiarity with each building.',
  'Cleaning is planned zone by zone, with high-touch areas done twice a day and deep cleans rotated through a quarterly program.',
];
const TEAM = [
  'A named account manager, two site supervisors and a relief pool of eight trained cleaners. Transition takes six weeks with a parallel run.',
  'One account manager and three supervisors. All staff complete site induction, manual handling and chemical safety before their first shift.',
  'A dedicated account manager supported by a regional operations lead. Transition is staged site by site over eight weeks.',
  'An account manager, supervisors on each shift and an on-call relief team. Transition uses a four-week overlap with the incumbent.',
];
const EXPERIENCE = [
  'Currently servicing 14 commercial sites across the region, including two government agencies, with no lost-time injuries in the last 24 months.',
  'Eleven years cleaning commercial and community buildings. References from three current clients are available on request.',
  'Eight years in commercial cleaning with a strong record in schools and offices. ISO 14001 certified.',
  'Five years in the market, growing from a regional base to nine sites. Reference clients include a hospital group.',
];

/** The technical response for one bidder (a short but real PDF). */
export function demoTechnicalResponse(company: string, index: number, tender: string): Buffer {
  const i = index % APPROACH.length;
  const blocks: PdfBlock[] = [
    { type: 'title', text: 'Technical response' },
    { type: 'subtitle', text: `${company} - response to: ${tender}` },
    { type: 'kv', label: 'Status', value: 'Synthetic demo document. Nothing here is real.' },
    { type: 'rule' },
    { type: 'h2', text: '1. Our approach' },
    { type: 'p', text: APPROACH[i]! },
    { type: 'bullet', text: 'Nightly cleaning to the agreed specification at every site.' },
    { type: 'bullet', text: 'Environmentally responsible products and waste practices.' },
    { type: 'bullet', text: 'Work health and safety plan, including induction and chemical safety.' },
    { type: 'h2', text: '2. Team and transition' },
    { type: 'p', text: TEAM[i]! },
    { type: 'h2', text: '3. Relevant experience' },
    { type: 'p', text: EXPERIENCE[i]! },
    { type: 'h2', text: '4. Compliance' },
    {
      type: 'p',
      text: 'We confirm compliance with all mandatory requirements in the tender pack and have declared no conflict of interest.',
    },
  ];
  return renderPdf({
    title: `Technical response - ${company}`,
    footer: `${company} - technical response - synthetic demo data`,
    created: new Date('2026-09-18T00:00:00Z'),
    blocks,
  });
}

/** The pricing schedule for one bidder (a small, real workbook). */
export function demoPricingSchedule(company: string, index: number): Buffer {
  const factor = [1, 0.96, 0.9, 1.12][index % 4]!;
  const items: Array<[string, number]> = [
    ['Nightly cleaning, all sites', 118000],
    ['Consumables and equipment', 14500],
    ['Waste and recycling', 9800],
    ['Management and reporting', 12000],
  ];
  const round = (v: number) => Math.round(v / 50) * 50;
  const rows: Array<Array<string | number>> = [
    [`${company} - pricing schedule (AUD, synthetic demo data)`],
    [],
    ['Item', 'Year 1', 'Year 2', 'Year 3', 'Total'],
  ];
  const totals = [0, 0, 0];
  for (const [name, base] of items) {
    const y = [0, 1, 2].map((k) => round(base * factor * Math.pow(1.03, k)));
    y.forEach((v, k) => (totals[k]! += v));
    rows.push([name, y[0]!, y[1]!, y[2]!, y.reduce((a, b) => a + b, 0)]);
  }
  rows.push(['Total', totals[0]!, totals[1]!, totals[2]!, totals.reduce((a, b) => a + b, 0)]);
  return buildXlsx('Pricing', rows);
}
