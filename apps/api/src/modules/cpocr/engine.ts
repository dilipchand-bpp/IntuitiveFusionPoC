/**
 * The OCR engines of contract ingestion (CP-07), behind one adapter interface.
 *
 *   - PdfTextLayerEngine is REAL: it reads the text layer of a PDF with unpdf (pdf.js, pure JavaScript, no network, nothing
 *     downloaded at run time). It cannot read pictures.
 *   - SimulatedOcrEngine is SIMULATED, labelled so everywhere: for images (PNG, JPG, TIFF) and scanned PDFs (no text layer) it
 *     does not look at pixels. It reads synthetic text from a fixture that travels with the file, either appended to the file
 *     between the markers IF-SIMULATED-OCR-BEGIN and IF-SIMULATED-OCR-END (viewers ignore bytes after an image or a PDF ends), or
 *     as a sidecar file named "<file name>.ocr.json" uploaded or zipped next to it. The fixture gives the text of each page and the
 *     page's recognition confidence, which is how a real engine reports. A file without a fixture is refused with a clear message.
 *
 * SWAP POINT (docs/swap-points.md, Procurement Copilot (BCP)): replace SimulatedOcrEngine with a class that calls a cloud
 * document-intelligence service (page images in, text and per-page confidence out). Nothing else changes: extraction, review,
 * commit and reporting only see OcrPage[] (page, text, confidence).
 */
import type { OcrKind } from '../../db/schema.js';
import type { OcrPage } from './types.js';

export type FileKind = OcrKind | 'ZIP';

export const SIM_BEGIN = 'IF-SIMULATED-OCR-BEGIN';
export const SIM_END = 'IF-SIMULATED-OCR-END';
export const MAX_PAGES = 200;
export const MAX_TEXT_CHARS = 400_000;

/** What the file is, from its first bytes (the extension is not trusted). */
export function sniff(b: Buffer): FileKind | null {
  if (b.length < 8) return null;
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'PNG';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPG';
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)
  )
    return 'TIFF';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6))
    return 'ZIP';
  return null;
}

export interface SimFixture {
  simulated: true;
  pages: Array<{ page?: number; text: string; confidence: number }>;
}

/** Validates a fixture from untrusted JSON. Returns null when it is not a usable fixture. */
export function parseFixture(raw: string): SimFixture | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = j as { pages?: unknown };
  if (
    !o ||
    typeof o !== 'object' ||
    !Array.isArray(o.pages) ||
    o.pages.length === 0 ||
    o.pages.length > MAX_PAGES
  )
    return null;
  let total = 0;
  const pages: SimFixture['pages'] = [];
  for (const p of o.pages as Array<Record<string, unknown>>) {
    if (
      typeof p?.text !== 'string' ||
      typeof p.confidence !== 'number' ||
      !(p.confidence >= 0 && p.confidence <= 1)
    )
      return null;
    total += p.text.length;
    if (total > MAX_TEXT_CHARS) return null;
    pages.push({
      text: p.text,
      confidence: p.confidence,
      ...(typeof p.page === 'number' ? { page: p.page } : {}),
    });
  }
  return { simulated: true, pages };
}

/** Appends a fixture to a file's bytes. Used to make synthetic samples; a real scan never carries one. */
export function embedFixture(bytes: Buffer, fixture: SimFixture): Buffer {
  return Buffer.concat([
    bytes,
    Buffer.from(`\n${SIM_BEGIN}\n${JSON.stringify(fixture)}\n${SIM_END}\n`, 'utf8'),
  ]);
}

function embeddedFixture(b: Buffer): SimFixture | null {
  const at = b.lastIndexOf(SIM_BEGIN);
  if (at < 0) return null;
  const end = b.indexOf(SIM_END, at);
  if (end < 0) return null;
  return parseFixture(
    b
      .subarray(at + SIM_BEGIN.length, end)
      .toString('utf8')
      .trim(),
  );
}

export interface OcrInput {
  name: string;
  bytes: Buffer;
  kind: OcrKind;
  /** Contents of "<name>.ocr.json" when one came with the file. */
  sidecar?: Buffer | undefined;
}

export interface OcrOutcome {
  engine: string;
  simulated: boolean;
  pages: OcrPage[];
  /** True when a PDF had no text layer and went to the simulated engine. */
  scanned: boolean;
  warnings: string[];
}

export class OcrUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrUnavailable';
  }
}

export interface OcrEngine {
  readonly id: string;
  readonly simulated: boolean;
  recognise(input: OcrInput): Promise<Omit<OcrOutcome, 'scanned'>>;
}

const tidy = (t: string) =>
  t
    .replace(/\r\n?/g, '\n')
    .replaceAll(String.fromCharCode(0), '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** REAL: the text layer of a PDF. */
export class PdfTextLayerEngine implements OcrEngine {
  readonly id = 'pdf-text-layer (unpdf)';
  readonly simulated = false;
  async recognise(input: OcrInput) {
    const { getDocumentProxy, extractText } = await import('unpdf');
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(input.bytes));
    } catch (e) {
      const msg = String((e as Error)?.name ?? e);
      throw new OcrUnavailable(
        /password/i.test(msg)
          ? 'The PDF is password protected.'
          : 'The PDF could not be opened; it may be damaged.',
      );
    }
    if (pdf.numPages > MAX_PAGES) throw new OcrUnavailable(`The PDF has more than ${MAX_PAGES} pages.`);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t, i) => ({ page: i + 1, text: tidy(t), confidence: 0.99 }));
    return { engine: this.id, simulated: false, pages, warnings: [] };
  }
}

/** SIMULATED: reads the fixture that travels with the file; never looks at pixels. */
export class SimulatedOcrEngine implements OcrEngine {
  readonly id = 'simulated-ocr-v1 (SIMULATED)';
  readonly simulated = true;
  async recognise(input: OcrInput) {
    const fx =
      (input.sidecar ? parseFixture(input.sidecar.toString('utf8')) : null) ?? embeddedFixture(input.bytes);
    if (!fx)
      throw new OcrUnavailable(
        'No text could be recognised. The SIMULATED recognition engine reads only synthetic sample files that carry a fixture (see docs/swap-points.md); a real document-intelligence service replaces it.',
      );
    const pages = fx.pages.map((p, i) => ({
      page: p.page ?? i + 1,
      text: tidy(p.text),
      confidence: p.confidence,
    }));
    return {
      engine: this.id,
      simulated: true,
      pages,
      warnings: ['SIMULATED recognition: the text comes from a synthetic fixture, not from the pixels.'],
    };
  }
}

const pdfEngine = new PdfTextLayerEngine();
const simEngine = new SimulatedOcrEngine();

/** Chooses the engine: a PDF with a text layer is read for real; images and scanned PDFs go to the simulated engine. */
export async function recogniseDocument(
  input: OcrInput,
  engines: { pdf?: OcrEngine; sim?: OcrEngine } = {},
): Promise<OcrOutcome> {
  const pdf = engines.pdf ?? pdfEngine;
  const sim = engines.sim ?? simEngine;
  if (input.kind === 'PDF') {
    const r = await pdf.recognise(input);
    const chars = r.pages.reduce((n, p) => n + p.text.replace(/\s+/g, '').length, 0);
    // a footer or page number is not a text layer: fewer than 60 characters of text means a scan
    if (chars >= 60) return { ...r, scanned: false };
    const s = await sim.recognise(input);
    return { ...s, scanned: true, warnings: ['The PDF has no text layer (a scan).', ...s.warnings] };
  }
  const s = await sim.recognise(input);
  return { ...s, scanned: false };
}
