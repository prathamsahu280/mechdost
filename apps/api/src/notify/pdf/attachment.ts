import type { BillSource } from '@mechdost/db/repo';
import type { OutboxRow } from '@mechdost/db/repo';
import {
  BILL_REF_KEY,
  billFilename,
  isBillAttachmentTemplate,
  orderReceiptDocument,
  serviceBillDocument,
  type BillAttachmentTemplate,
  type BillDocument,
  type BillLocale,
} from '@mechdost/shared/bill-document';
import { companyFor, type CompanyDetails } from '@mechdost/shared/company';
import { renderBillPdf, type BillCompany } from './render';

/**
 * Builds the PDF that rides on a bill email (Q194, spec 10), at send time in the worker: the outbox row only carries an
 * id (`billRef`), the data comes from the stored bill or order snapshot (`loadSource`, owner-checked against the row's
 * recipient), the company block from the admin's Company details. Returns null when there is nothing to attach (the mail
 * then goes without); throws nothing it does not mean to (the adapter catches and logs the failure class only).
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface BillAttachmentDeps {
  loadSource: (input: {
    template: BillAttachmentTemplate;
    ref: string;
    recipientUserId: string | null;
  }) => Promise<BillSource | null>;
  loadCompany: () => Promise<CompanyDetails>;
}

/**
 * Built-in company facts, used for any field the admin has not filled (Admin -> Settings -> Company details wins).
 * Mirrors `apps/web/src/lib/site.ts` (registered GSTIN and office, confirmed by the user 2026-11-01, Q15).
 */
const FALLBACK = {
  en: {
    company: 'Shourya Integrated Services Pvt Ltd',
    registeredAddress: 'C-605 Salasar Greens, Sarona, Tatibandh, Raipur 492099',
    gstin: '22ABVCS4888H1ZL',
  },
  hi: {
    company: 'शौर्य इंटीग्रेटेड सर्विसेज़ प्राइवेट लिमिटेड',
    registeredAddress: 'C-605 सालासर ग्रीन्स, सरोना, टाटीबंध, रायपुर 492099',
    gstin: '22ABVCS4888H1ZL',
  },
} as const;

export function billCompany(details: CompanyDetails, locale: BillLocale): BillCompany {
  const facts = companyFor(details, locale, FALLBACK[locale]);
  return { name: facts.company, address: facts.registeredAddress, gstin: facts.gstin, cin: facts.cin };
}

export function createBillAttachmentLoader(deps: BillAttachmentDeps) {
  return async (row: OutboxRow, locale: BillLocale): Promise<EmailAttachment | null> => {
    if (!isBillAttachmentTemplate(row.templateKey)) return null;
    const ref = row.payload[BILL_REF_KEY];
    if (typeof ref !== 'string' || ref === '') return null;
    const found = await deps.loadSource({
      template: row.templateKey,
      ref,
      recipientUserId: row.recipientUserId,
    });
    if (!found) return null;
    const doc: BillDocument =
      found.kind === 'service'
        ? serviceBillDocument(found.source, locale)
        : orderReceiptDocument(found.source, locale);
    const content = await renderBillPdf(doc, billCompany(await deps.loadCompany(), locale));
    return { filename: billFilename(doc.code, doc.kind), content };
  };
}
