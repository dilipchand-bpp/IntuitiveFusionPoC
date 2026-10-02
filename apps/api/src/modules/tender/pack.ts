import { TENDER_TYPE_NAME, type TenderType } from './fields.js';

export interface PackInput {
  type: TenderType;
  title: string;
  organisation: string;
  category?: string | undefined;
  termMonths?: string | undefined;
  businessUnit?: string | undefined;
  /** Plan sections by key (background, requirements, deliverables, milestones ...). */
  plan: Record<string, string | undefined>;
  /** Request values by key (background, deliverables ...). Used when the plan has no text for a section. */
  request: Record<string, string | undefined>;
  contactEmail: string;
  statutoryMinDays?: number | undefined;
}

const clean = (s: string | undefined) => (s ?? '').trim();

/**
 * Paragraphs that talk about money, risk rating, governance or internal approval are internal. Text copied from the plan
 * or the request is filtered through this before it can reach suppliers, so a budget sentence in the plan background can
 * never end up in the tender pack.
 */
const INTERNAL =
  /estimated value|\bAUD\b|\$\s?\d|budget|complexity|governance|risk|delegat|approv|steering|committee|probity|conflict|sign-off|\bplan\b|contract owner/i;
export const publicText = (s: string | undefined): string =>
  clean(s)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !INTERNAL.test(p))
    .join('\n\n');
const paras = (...xs: Array<string | undefined>) => xs.map(clean).filter(Boolean).join('\n\n');

/** Weighted criteria by type. Price is not scored for information-gathering documents. */
const CRITERIA: Record<TenderType, Array<[string, number]>> = {
  RFT: [
    ['Technical capability and approach', 40],
    ['Delivery, transition and risk management', 20],
    ['Price and commercial terms', 30],
    ['Experience and references', 10],
  ],
  RFP: [
    ['Quality of proposed solution', 40],
    ['Delivery approach and team', 20],
    ['Price and value for money', 30],
    ['Experience and references', 10],
  ],
  RFQ: [
    ['Compliance with the specification (pass or fail)', 0],
    ['Price', 100],
  ],
  RFI: [['Relevance and completeness of the information provided (not scored for award)', 0]],
  EOI: [['Capability and relevant experience (used to shortlist, not to award)', 0]],
};

/**
 * Builds a tender pack from the approved plan and the request. Deterministic template, no AI: the same inputs always
 * give the same pack, so a procurement lead can trust what changed when they edit it (US-TND-01).
 * The estimated value is deliberately never written into the pack.
 */
export function buildTenderPack(i: PackInput): Record<string, string> {
  const kind = TENDER_TYPE_NAME[i.type];
  const term = i.termMonths ? `over a term of ${i.termMonths} months` : 'for the term described below';
  const priced = i.type === 'RFT' || i.type === 'RFP' || i.type === 'RFQ';
  const award = i.type === 'RFT' || i.type === 'RFP' || i.type === 'RFQ';

  const criteria = CRITERIA[i.type];
  const criteriaText = criteria
    .map(([name, w]) => (w > 0 ? `${name}: ${w}%` : name))
    .concat(
      priced
        ? ['Responses are scored independently by each evaluator, then agreed by the panel.']
        : [
            'Responses help the organisation decide how to proceed; no contract is awarded from this document.',
          ],
    )
    .join('\n\n');

  return {
    overview: paras(
      `${i.organisation} invites responses to this ${kind}: ${i.title}.`,
      i.category ? `Category: ${i.category}.` : undefined,
      publicText(i.plan.background) || publicText(i.request.background),
      `The successful respondent would provide the goods or services ${term}${i.businessUnit ? `, for ${i.businessUnit}` : ''}.`,
    ),
    scope:
      paras(publicText(i.plan.objectives)) ||
      `The scope is ${i.title}${i.category ? ` (${i.category})` : ''}${i.businessUnit ? ` for ${i.businessUnit}` : ''}. See Requirements and Deliverables for detail.`,
    requirements:
      paras(publicText(i.plan.requirements)) ||
      'The detailed requirements will be confirmed by the procurement lead.',
    deliverables:
      paras(publicText(i.plan.deliverables), publicText(i.request.deliverables)) ||
      'Deliverables to be confirmed.',
    timetable: paras(
      publicText(i.plan.milestones),
      'The closing date and time are shown on the tender page. Responses are locked automatically at that time: nothing can be uploaded or submitted after it.',
    ),
    evaluationCriteria: criteriaText,
    conditions: paras(
      'Respondents must declare any conflict of interest in their response.',
      'Questions are answered for all respondents at once, without saying who asked.',
      award
        ? 'The organisation does not commit to accept the lowest priced or any response.'
        : 'This document does not commit the organisation to any purchase.',
      i.statutoryMinDays
        ? `A minimum of ${i.statutoryMinDays} days is allowed between publication and closing.`
        : undefined,
    ),
    submission: paras(
      'Upload your response in the supplier portal and press Submit. You will receive a receipt with the date and time.',
      'Accepted files: PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG and ZIP, up to 10 MB each. Include at least one technical and one commercial file.',
      'You can replace your files and submit again at any time before the closing time; the last submission before closing is the one evaluated.',
    ),
    contact: `Ask questions in the portal. Questions are published to all respondents, without naming the questioner. General enquiries: ${i.contactEmail}.`,
  };
}
