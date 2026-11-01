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
  whatsappNumber: '917978776551',
  defaultCity: 'raipur',
} as const;

/** wa.me deep link with a drafted message; WhatsApp shows the draft and the user decides to send. */
export function whatsappLink(text: string): string {
  return `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(text)}`;
}
