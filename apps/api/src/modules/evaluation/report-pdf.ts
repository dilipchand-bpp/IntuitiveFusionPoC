import { renderDocx } from '../../documents/docx.js';
import { renderPdf, type PdfBlock, type PdfDocument } from '../../documents/pdf.js';

export interface ReportPdfInput {
  requestNumber: string;
  title: string;
  tenderType: string;
  evaluationVersion: number;
  reportStatus: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED';
  generatedAt: Date;
  sections: Array<{ label: string; paragraphs: string[] }>;
  ranking: Array<{ displayName: string; weightedScore: number; rank: number | null; compliance: string }>;
  decision?: { stamp: string } | undefined;
  probity?: { stamp: string } | null | undefined;
}

const STATUS = {
  DRAFT: 'Needs regenerating',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
} as const;
const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The report as document blocks, shared by the PDF and the Word export so the two never differ. */
export function reportDocument(i: ReportPdfInput): PdfDocument {
  const blocks: PdfBlock[] = [
    { type: 'title', text: 'Evaluation report' },
    { type: 'subtitle', text: `${i.requestNumber} ${i.title}` },
    { type: 'kv', label: 'Procurement type', value: i.tenderType },
    { type: 'kv', label: 'Report status', value: STATUS[i.reportStatus] },
    { type: 'kv', label: 'Generated', value: stamp(i.generatedAt) },
    { type: 'kv', label: 'Version', value: `Evaluation record version ${i.evaluationVersion}` },
    ...(i.decision ? ([{ type: 'kv', label: 'Approval', value: i.decision.stamp }] as PdfBlock[]) : []),
    ...(i.probity ? ([{ type: 'kv', label: 'Probity sign-off', value: i.probity.stamp }] as PdfBlock[]) : []),
    { type: 'rule' },
  ];
  for (const s of i.sections) {
    blocks.push({ type: 'h2', text: s.label });
    if (s.label === 'Ranking' && i.ranking.length > 0) {
      blocks.push({
        type: 'table',
        columns: [
          { label: 'Rank', width: 0.12 },
          { label: 'Supplier', width: 0.5 },
          { label: 'Score (of 100)', width: 0.2, align: 'right' },
          { label: 'Compliance', width: 0.18 },
        ],
        rows: i.ranking.map((r) => [
          r.rank === null ? '-' : String(r.rank),
          r.displayName,
          r.weightedScore.toFixed(1),
          r.compliance === 'PASS' ? 'Compliant' : 'Not compliant',
        ]),
      });
      continue;
    }
    for (const p of s.paragraphs) blocks.push({ type: 'p', text: p });
  }
  return {
    title: `Evaluation report ${i.requestNumber}`,
    footer: `Evaluation report ${i.requestNumber} - generated ${stamp(i.generatedAt)} - version ${i.evaluationVersion}`,
    created: i.generatedAt,
    blocks,
  };
}

/** The evaluation report as a PDF carrying its generation time and version on every page (US-TND-05). */
export const evaluationReportPdf = (i: ReportPdfInput): Buffer => renderPdf(reportDocument(i));
/** The same report as a Word document. */
export const evaluationReportDocx = (i: ReportPdfInput): Buffer => renderDocx(reportDocument(i));
