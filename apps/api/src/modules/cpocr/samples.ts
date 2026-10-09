/**
 * Synthetic sample contracts for contract ingestion (CP-07). Everything here is invented: no real organisation, person or ABN
 * (the ABNs are valid by the check-digit rule only so the ABN check can be shown passing). Used by the tests, the demo seed, the
 * "Try a sample" button and the committed e2e fixtures (apps/api/src/modules/cpocr/make-fixtures.ts writes those).
 *
 *   services-agreement   text-layer PDF, two pages, every clause present: reads cleanly (READY)
 *   saas-subscription    text-layer PDF, USD, no end date written, offshore data, no indemnity / insurance / convenience clause
 *   office-licence       text-layer PDF, licence fee per annum (value is derived), no confidentiality or liability clause
 *   scanned-security     PNG with a SIMULATED recognition fixture at 72% page confidence and a garbled end date
 *   scanned-it-support   scanned PDF (no text layer) with a SIMULATED fixture at 94% confidence: reads cleanly
 */
import { deflateSync, crc32 } from 'node:zlib';
import { renderPdf, type PdfBlock } from '../../documents/pdf.js';
import { embedFixture, type SimFixture } from './engine.js';

export type SampleKind = 'PDF' | 'PNG' | 'JPG' | 'TIFF';

interface Section {
  heading: string;
  body: string;
  /** Start a new page before this section (text-layer PDFs only). */
  newPage?: boolean;
}

interface SampleDef {
  key: string;
  fileName: string;
  title: string;
  kind: SampleKind;
  description: string;
  /** Simulated samples carry a fixture with this page confidence. */
  simulatedConfidence?: number;
  /** A scanned PDF: pictures only, no text layer. */
  scannedPdf?: boolean;
  intro: string[];
  sections: Section[];
}

const FOOTER = 'SYNTHETIC SAMPLE for the proof of concept - not a real agreement';

export const SAMPLE_DEFS: SampleDef[] = [
  {
    key: 'services-agreement',
    fileName: 'services-agreement.pdf',
    title: 'FACILITIES MANAGEMENT SERVICES AGREEMENT',
    kind: 'PDF',
    description: 'Text-layer PDF, two pages, every clause present.',
    intro: ['Agreement number: FMS-2025-0031'],
    sections: [
      {
        heading: '1. Parties',
        body: 'This agreement is made on 1 July 2025 between Meridian Group (demo) (the Customer) and Brightwave Cleaning Pty Ltd (ABN 51 824 753 556) (the Supplier).',
      },
      {
        heading: '2. Term',
        body: 'The agreement commences on 1 July 2025 (the Effective Date) and continues until 30 June 2028 (the End Date), a term of 36 months. The Customer may extend the term for two further periods of 12 months each by giving written notice at least 90 days before the End Date.',
      },
      {
        heading: '3. Fees and payment',
        body: 'The total contract value is AUD $1,250,000 (excluding GST). The Customer will pay each valid invoice within 30 days of receipt.',
      },
      {
        heading: '4. Service levels',
        body: 'The Supplier will meet a service availability of 99.5% each month and will respond to priority 1 incidents within 2 hours. Failure to meet a service level entitles the Customer to service credits.',
      },
      {
        heading: '5. Termination',
        body: 'The Customer may terminate this agreement for convenience by giving the Supplier 60 days written notice. Either party may terminate immediately for material breach that is not remedied within 14 days of notice.',
      },
      {
        heading: '6. Confidentiality',
        body: "Each party must keep the other party's confidential information confidential and must comply with applicable privacy law.",
      },
      {
        heading: '7. Liability and indemnity',
        body: "The Supplier's total aggregate liability under this agreement is limited to AUD $2,500,000. The Supplier indemnifies the Customer against loss arising from the Supplier's negligence or breach of this agreement.",
      },
      {
        heading: '8. Insurance',
        body: 'The Supplier must hold public liability insurance of at least $10 million and professional indemnity insurance of at least $5 million for the whole term.',
      },
      {
        heading: '9. Data location',
        body: 'All Customer data must be stored and processed within Australia.',
        newPage: true,
      },
      {
        heading: '10. Governing law',
        body: 'This agreement is governed by the laws of New South Wales, and the parties submit to the non-exclusive jurisdiction of its courts.',
      },
    ],
  },
  {
    key: 'saas-subscription',
    fileName: 'saas-subscription.pdf',
    title: 'SOFTWARE AS A SERVICE SUBSCRIPTION AGREEMENT',
    kind: 'PDF',
    description:
      'Text-layer PDF in US dollars. No end date written, data hosted offshore, no indemnity, insurance or convenience clause.',
    intro: ['Agreement number: SAAS-2026-0204'],
    sections: [
      {
        heading: '1. Parties',
        body: 'This agreement is made between Meridian Group (demo) (the Customer) and CloudLedger Software Pty Ltd (ABN 77 100 000 001) (the Supplier).',
      },
      {
        heading: '2. Subscription term',
        body: 'The subscription starts on 15 March 2026 (the Start Date) for a Subscription Term of 36 months. The subscription renews automatically for successive 12 month periods unless either party gives notice of non-renewal at least 60 days before the end of the then-current term.',
      },
      {
        heading: '3. Fees',
        body: 'The total fees payable over the Subscription Term are USD 180,000. The Supplier will invoice annually in advance and each invoice is payable within 45 days of the invoice date.',
      },
      {
        heading: '4. Availability',
        body: "The Supplier will meet a service availability of 99.9% each month, measured by the Supplier's monitoring tools.",
      },
      {
        heading: '5. Hosting',
        body: 'Customer data is hosted in data centres located in the United States.',
      },
      {
        heading: '6. Termination',
        body: 'Either party may terminate this agreement immediately by written notice if the other party commits a material breach that is not remedied within 30 days of notice.',
      },
      {
        heading: '7. Confidentiality',
        body: "Each party must keep the other party's confidential information confidential.",
      },
      {
        heading: '8. Limitation of liability',
        body: "The Supplier's total liability under this agreement is limited to the fees paid or payable in the 12 months before the claim arose.",
      },
      {
        heading: '9. Governing law',
        body: 'This agreement is governed by the laws of Victoria, Australia.',
      },
    ],
  },
  {
    key: 'office-licence',
    fileName: 'office-licence.pdf',
    title: 'LICENCE TO OCCUPY OFFICE PREMISES',
    kind: 'PDF',
    description:
      'Text-layer PDF for a licence of premises. The fee is per annum, so the contract value is derived; no confidentiality or liability clause.',
    intro: ['Licence number: LIC-2025-0077'],
    sections: [
      {
        heading: '1. Parties',
        body: 'This licence is made between Harbourside Property Holdings Pty Ltd (ABN 58 100 000 002) (the Licensor) and Meridian Group (demo) (the Licensee).',
      },
      {
        heading: '2. Licence term',
        body: 'The licence commences on 1 February 2026 and expires on 31 January 2031, a term of five (5) years. The Licensee has one option to renew this licence for a further term of five (5) years by giving written notice not less than six (6) months before expiry.',
      },
      {
        heading: '3. Licence fee',
        body: 'The licence fee is $102,000 per annum (excluding GST), payable monthly in advance within 14 days of the invoice date.',
      },
      {
        heading: '4. Termination',
        body: 'Either party may terminate this licence by written notice if the other party commits a material breach that is not remedied within 28 days of notice. The Licensor may also terminate this licence for convenience by giving the Licensee 6 months written notice.',
      },
      {
        heading: '5. Indemnity',
        body: "The Licensee indemnifies the Licensor against any claim arising from the Licensee's use of the premises.",
      },
      {
        heading: '6. Insurance',
        body: 'The Licensee must hold public liability insurance of at least $20 million for the whole term.',
      },
      {
        heading: '7. Governing law',
        body: 'This licence is governed by the laws of Queensland.',
      },
    ],
  },
  {
    key: 'scanned-security',
    fileName: 'scanned-security-services.png',
    title: 'SECURITY GUARD SERVICES AGREEMENT',
    kind: 'PNG',
    simulatedConfidence: 0.72,
    description:
      'A scanned image (SIMULATED recognition, 72% page confidence). The end date is garbled, so a reviewer must supply it.',
    intro: ['Agreement number: SEC-2026-0019'],
    sections: [
      {
        heading: '1. Parties',
        body: 'This agreement is made between Meridian Group (demo) (the Customer) and Redgum Security Services Pty Ltd (ABN 39 100 000 003) (the Supplier).',
      },
      {
        heading: '2. Term',
        body: 'The agreement commences on 1 March 2026 and ends on 28 Febr uary 2027.',
      },
      {
        heading: '3. Price and payment',
        body: 'The total contract value is $96,000 (excluding GST). The Customer will pay each valid invoice within 30 days of receipt.',
      },
      {
        heading: '4. Termination',
        body: 'The Customer may terminate this agreement for convenience by giving the Supplier 30 days written notice.',
      },
      {
        heading: '5. Confidentiality',
        body: "Each party must keep the other party's confidential information confidential.",
      },
      {
        heading: '6. Governing law',
        body: 'This agreement is governed by the laws of New South Wales.',
      },
    ],
  },
  {
    key: 'scanned-it-support',
    fileName: 'scanned-it-support.pdf',
    title: 'IT SUPPORT SERVICES AGREEMENT',
    kind: 'PDF',
    scannedPdf: true,
    simulatedConfidence: 0.94,
    description:
      'A scanned PDF with no text layer (SIMULATED recognition, 94% page confidence): reads cleanly.',
    intro: ['Agreement number: ITS-2026-0044'],
    sections: [
      {
        heading: '1. Parties',
        body: 'This agreement is made between Meridian Group (demo) (the Customer) and Kestrel IT Support Pty Ltd (ABN 20 100 000 004) (the Supplier).',
      },
      {
        heading: '2. Term',
        body: 'The agreement commences on 1 February 2026 and ends on 31 January 2027, a term of 12 months. The Customer may extend the term for one further period of 12 months by giving written notice at least 60 days before the End Date.',
      },
      {
        heading: '3. Price and payment',
        body: 'The total contract value is AUD 240,000 (excluding GST). The Customer will pay each valid invoice within 30 days of receipt.',
      },
      {
        heading: '4. Termination',
        body: 'The Customer may terminate this agreement for convenience by giving the Supplier 45 days written notice. Either party may terminate immediately for material breach that is not remedied within 14 days of notice.',
      },
      {
        heading: '5. Confidentiality',
        body: "Each party must keep the other party's confidential information confidential and must comply with applicable privacy law.",
      },
      {
        heading: '6. Liability and indemnity',
        body: "The Supplier's total aggregate liability under this agreement is limited to AUD $480,000. The Supplier indemnifies the Customer against loss arising from the Supplier's negligence or breach of this agreement.",
      },
      {
        heading: '7. Insurance',
        body: 'The Supplier must hold public liability insurance of at least $10 million and professional indemnity insurance of at least $5 million for the whole term.',
      },
      {
        heading: '8. Governing law',
        body: 'This agreement is governed by the laws of Victoria, and the parties submit to the non-exclusive jurisdiction of its courts.',
      },
    ],
  },
];

export const SAMPLE_KEYS = SAMPLE_DEFS.map((s) => s.key);

/** The page text a clean text layer would give: title, intro lines, then each heading with its body. */
export function sampleText(def: SampleDef): string {
  return [def.title, ...def.intro, '', ...def.sections.flatMap((s) => [s.heading, s.body, ''])]
    .join('\n')
    .trim();
}

function textLayerPdf(def: SampleDef): Buffer {
  const blocks: PdfBlock[] = [
    { type: 'title', text: def.title },
    ...def.intro.map((t): PdfBlock => ({ type: 'p', text: t })),
  ];
  for (const s of def.sections) {
    if (s.newPage) blocks.push({ type: 'space', height: 760 });
    blocks.push({ type: 'h2', text: s.heading }, { type: 'p', text: s.body });
  }
  return renderPdf({ title: def.title, footer: FOOTER, created: new Date('2026-10-01T00:00:00Z'), blocks });
}

/** A PDF page that draws a rectangle and no text: what a scan looks like to a text extractor. */
function imageOnlyPdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>',
  ];
  const content = '0.9 g 56 56 483 730 re f 0.3 G 56 56 483 730 re S';
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A valid 8x8 grey PNG: a placeholder for a scanned page (the simulated engine never looks at pixels). */
export function placeholderPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.concat(
    Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(8, 0xe0)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Minimal JPEG and TIFF containers: enough to be recognised by their first bytes. Placeholders, not viewable pictures. */
export function placeholderJpg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
  ]);
}
export function placeholderTiff(): Buffer {
  return Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

export function fixtureFor(def: SampleDef): SimFixture {
  return {
    simulated: true,
    pages: [{ page: 1, text: sampleText(def), confidence: def.simulatedConfidence ?? 0.9 }],
  };
}

export interface BuiltSample {
  key: string;
  fileName: string;
  title: string;
  description: string;
  kind: SampleKind;
  simulated: boolean;
  bytes: Buffer;
}

export function buildSample(key: string): BuiltSample | null {
  const def = SAMPLE_DEFS.find((s) => s.key === key);
  if (!def) return null;
  let bytes: Buffer;
  if (def.simulatedConfidence !== undefined) {
    const base = def.scannedPdf
      ? imageOnlyPdf()
      : def.kind === 'PNG'
        ? placeholderPng()
        : def.kind === 'JPG'
          ? placeholderJpg()
          : placeholderTiff();
    bytes = embedFixture(base, fixtureFor(def));
  } else bytes = textLayerPdf(def);
  return {
    key: def.key,
    fileName: def.fileName,
    title: def.title,
    description: def.description,
    kind: def.kind,
    simulated: def.simulatedConfidence !== undefined,
    bytes,
  };
}

/** A PDF with a text layer built from plain lines, for tests that need ad hoc wording. */
export function pdfFromLines(lines: string[], title = 'TEST AGREEMENT'): Buffer {
  return renderPdf({
    title,
    footer: FOOTER,
    created: new Date('2026-10-01T00:00:00Z'),
    blocks: lines.map((t, i): PdfBlock => (i === 0 ? { type: 'title', text: t } : { type: 'p', text: t })),
  });
}
