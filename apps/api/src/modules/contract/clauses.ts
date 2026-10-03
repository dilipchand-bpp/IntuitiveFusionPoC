/**
 * Contract drafting rules (M10, US-CON-01). Pure functions: pick the template for a tender route, assemble the
 * clauses from the library with the winning supplier's data filled in, and judge whether a draft may be released.
 */

export interface LibraryClause {
  id: string;
  title: string;
  text: string;
  mandatory: boolean;
}

export interface TemplateBody {
  appliesTo: string[];
  clauses: LibraryClause[];
}

export interface ContractFacts {
  customer: string;
  supplier: string;
  abn: string;
  title: string;
  requestNumber: string;
  value: number;
  startDate: string;
  endDate: string;
  noticeDays: number;
  serviceLevels: string;
}

/** Signing chain: a delegate always signs; above this value an executive must also sign. */
export const EXEC_COSIGN_ABOVE = 1_000_000;

export interface Signer {
  role: 'DELEGATE' | 'EXEC';
  label: string;
}

export function requiredSigners(value: number): Signer[] {
  const chain: Signer[] = [{ role: 'DELEGATE', label: 'Authorised delegate' }];
  if (value > EXEC_COSIGN_ABOVE) chain.push({ role: 'EXEC', label: 'Executive' });
  return chain;
}

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Placeholders in library text look like {{SUPPLIER}}. Unknown ones are left visible so a reviewer sees them. */
export function fill(text: string, f: ContractFacts): string {
  const map: Record<string, string> = {
    CUSTOMER: f.customer,
    SUPPLIER: f.supplier,
    ABN: f.abn,
    TITLE: f.title,
    REQUEST: f.requestNumber,
    VALUE: aud.format(f.value),
    START: longDate(f.startDate),
    END: longDate(f.endDate),
    NOTICE_DAYS: String(f.noticeDays),
    SLA: f.serviceLevels,
  };
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => map[k] ?? m);
}

/** The template whose route list contains the tender type (RFT, RFP, RFQ). */
export function pickTemplate<T extends { id: string; body: unknown }>(
  templates: T[],
  tenderType: string,
): T | null {
  const hit = templates.filter((t) =>
    (t.body as Partial<TemplateBody> | null)?.appliesTo?.includes(tenderType),
  );
  return hit.sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export interface DraftClause {
  clauseId: string;
  title: string;
  text: string;
  mandatory: boolean;
  changedFromTemplate: boolean;
}

/** Assembles every library clause, in library order. Mandatory clauses can never be left out. */
export function assembleClauses(body: TemplateBody, f: ContractFacts): DraftClause[] {
  return body.clauses.map((c) => ({
    clauseId: c.id,
    title: c.title,
    text: fill(c.text, f),
    mandatory: c.mandatory,
    changedFromTemplate: false,
  }));
}

/** What would stop a draft from being released for signature. */
export function releaseBlockers(
  c: { value: number; startDate: string | null; endDate: string | null },
  clauses: Array<{ title: string; text: string; mandatory: boolean }>,
): string[] {
  const out: string[] = [];
  for (const k of clauses) {
    if (k.mandatory && k.text.trim().length < 10) out.push(`Mandatory clause "${k.title}" is empty`);
    if (/\{\{[A-Z_]+\}\}/.test(k.text)) out.push(`Clause "${k.title}" still has an unfilled placeholder`);
  }
  if (!(c.value > 0)) out.push('The contract value is missing');
  if (!c.startDate || !c.endDate) out.push('Start and end dates are required');
  else if (c.endDate <= c.startDate) out.push('The end date must be after the start date');
  return out;
}

export function nextNumber(year: number, existing: string[]): string {
  const prefix = `CT-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** The standard clause libraries seeded as templates. */
export const SERVICES_TEMPLATE: TemplateBody = {
  appliesTo: ['RFP', 'RFQ'],
  clauses: [
    {
      id: 'PARTIES',
      title: 'Parties and purpose',
      mandatory: true,
      text: 'This agreement is made between {{CUSTOMER}} (the Customer) and {{SUPPLIER}} (ABN {{ABN}}) (the Supplier) for {{TITLE}} ({{REQUEST}}).',
    },
    {
      id: 'TERM',
      title: 'Term and extension',
      mandatory: true,
      text: 'The agreement starts on {{START}} and ends on {{END}}. Either party may decline an extension by giving {{NOTICE_DAYS}} days written notice before the end date.',
    },
    {
      id: 'PRICE',
      title: 'Pricing and payment',
      mandatory: true,
      text: 'The total contract value is {{VALUE}} (excluding GST) as set out in the Supplier pricing schedule. Valid invoices are paid within 30 days of receipt.',
    },
    {
      id: 'SLA',
      title: 'Service levels',
      mandatory: false,
      text: 'The Supplier will meet the following service levels: {{SLA}}',
    },
    {
      id: 'TERMINATION',
      title: 'Termination',
      mandatory: true,
      text: 'The Customer may terminate for convenience on {{NOTICE_DAYS}} days written notice, and immediately for material breach that is not remedied within 14 days of notice.',
    },
    {
      id: 'IP',
      title: 'Intellectual property',
      mandatory: false,
      text: 'Intellectual property created for the Customer under this agreement belongs to the Customer. The Supplier keeps its pre-existing intellectual property.',
    },
    {
      id: 'CONFIDENTIALITY',
      title: 'Confidentiality and privacy',
      mandatory: true,
      text: 'Each party keeps the other party confidential information confidential and complies with applicable privacy law.',
    },
    {
      id: 'LIABILITY',
      title: 'Liability and insurance',
      mandatory: true,
      text: 'The Supplier holds public liability and professional indemnity insurance appropriate to the services for the whole term, and provides a current certificate on request.',
    },
  ],
};

export const WORKS_TEMPLATE: TemplateBody = {
  appliesTo: ['RFT'],
  clauses: [
    {
      id: 'PARTIES',
      title: 'Parties and purpose',
      mandatory: true,
      text: 'This agreement is made between {{CUSTOMER}} (the Principal) and {{SUPPLIER}} (ABN {{ABN}}) (the Contractor) for {{TITLE}} ({{REQUEST}}).',
    },
    {
      id: 'TERM',
      title: 'Term and extension',
      mandatory: true,
      text: 'Works start on {{START}} and reach completion by {{END}}. Extensions of time are granted only in writing. Notice period: {{NOTICE_DAYS}} days.',
    },
    {
      id: 'PRICE',
      title: 'Price and progress payments',
      mandatory: true,
      text: 'The contract sum is {{VALUE}} (excluding GST). Progress claims are paid within 30 days of a valid claim.',
    },
    {
      id: 'SLA',
      title: 'Performance requirements',
      mandatory: false,
      text: 'The Contractor will meet the following performance requirements: {{SLA}}',
    },
    {
      id: 'WARRANTY',
      title: 'Defects and warranty',
      mandatory: true,
      text: 'The Contractor rectifies defects notified within 12 months of completion at its own cost.',
    },
    {
      id: 'TERMINATION',
      title: 'Termination',
      mandatory: true,
      text: 'The Principal may terminate for convenience on {{NOTICE_DAYS}} days written notice, and immediately for substantial breach not remedied within 14 days of notice.',
    },
    {
      id: 'WHS',
      title: 'Work health and safety',
      mandatory: true,
      text: 'The Contractor complies with all work health and safety law and reports every notifiable incident to the Principal at once.',
    },
    {
      id: 'LIABILITY',
      title: 'Liability and insurance',
      mandatory: true,
      text: 'The Contractor holds public liability and contract works insurance for the whole term and provides a current certificate on request.',
    },
  ],
};
