/** The tender pack as a document (US-TND-05): the same fields the supplier reads, with status and version, for print. */
import { renderDocx } from '../../documents/docx.js';
import { renderPdf, type PdfBlock, type PdfDocument } from '../../documents/pdf.js';

export interface PackDocInput {
  number: string;
  title: string;
  type: string;
  status: string;
  version: number;
  opensAt: Date | null;
  closesAt: Date | null;
  generatedAt: Date;
  fields: Array<{ label: string; paragraphs: string[] }>;
}

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function packDocument(i: PackDocInput): PdfDocument {
  const blocks: PdfBlock[] = [
    { type: 'title', text: `Tender pack: ${i.title}` },
    { type: 'subtitle', text: `${i.number} - ${i.type}` },
    { type: 'kv', label: 'Status', value: i.status },
    { type: 'kv', label: 'Opens', value: i.opensAt ? stamp(i.opensAt) : 'Not set' },
    { type: 'kv', label: 'Closes', value: i.closesAt ? stamp(i.closesAt) : 'Not set' },
    { type: 'kv', label: 'Pack version', value: String(i.version) },
    { type: 'kv', label: 'Exported', value: stamp(i.generatedAt) },
    { type: 'rule' },
  ];
  for (const f of i.fields) {
    blocks.push({ type: 'h2', text: f.label });
    if (f.paragraphs.length === 0) blocks.push({ type: 'p', text: 'Not yet written.' });
    for (const p of f.paragraphs) blocks.push({ type: 'p', text: p });
  }
  return {
    title: `Tender pack ${i.number}`,
    footer: `Tender pack ${i.number} - exported ${stamp(i.generatedAt)} - version ${i.version}`,
    created: i.generatedAt,
    blocks,
  };
}

export const packPdf = (i: PackDocInput) => renderPdf(packDocument(i));
export const packDocx = (i: PackDocInput) => renderDocx(packDocument(i));
