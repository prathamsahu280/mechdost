/**
 * Contact and company facts used across the shell. Moves to the admin-editable `settings` table with the CMS
 * (hard rule 8, docs/specs/08). GSTIN and registered address confirmed by the user 2026-11-01 (inbox Q15); CIN and
 * grievance officer name still to come (Q15b).
 */
export const site = {
  company: 'Shourya Integrated Services Pvt Ltd',
  gstin: '22ABVCS4888H1ZL',
  registeredAddress: 'C-605 Salasar Greens, Sarona, Tatibandh, Raipur 492099',
  supportPhone: '7978776551',
  supportPhoneE164: '+917978776551',
  /** Support mailbox (the account emails already name it); the grievance card shows it until Q-U4 is answered. */
  supportEmail: 'support@mechdost.com',
  whatsappNumber: '917978776551',
  defaultCity: 'raipur',
  /** Coverage name in copy (user 2026-11-22: Chhattisgarh, not Raipur): key into the `regions` locale namespace. */
  defaultRegion: 'chhattisgarh',
} as const;

/**
 * Operator name and registered office in the page language (hard rule 10, 2026-11-02). Hindi pages show them
 * transliterated, like every business name; GST invoices and filings keep the registered (English) form.
 */
const COMPANY_HI = {
  company: 'शौर्य इंटीग्रेटेड सर्विसेज़ प्राइवेट लिमिटेड',
  registeredAddress: 'C-605 सालासर ग्रीन्स, सरोना, टाटीबंध, रायपुर 492099',
} as const;

export function companyFacts(locale: string): { company: string; registeredAddress: string } {
  return locale === 'hi' ? COMPANY_HI : { company: site.company, registeredAddress: site.registeredAddress };
}

/** wa.me deep link with a drafted message; WhatsApp shows the draft and the user decides to send. */
export function whatsappLink(text: string): string {
  return `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(text)}`;
}
