/**
 * Contact and company facts used across the shell. Moves to the admin-editable `settings` table with the CMS
 * (hard rule 8, docs/specs/08); legal details still need the user's verification (inbox Q15).
 */
export const site = {
  company: 'Shourya Integrated Services Pvt Ltd',
  supportPhone: '7978776551',
  supportPhoneE164: '+917978776551',
  whatsappNumber: '917978776551',
  defaultCity: 'raipur',
} as const;

/** wa.me deep link with a drafted message; WhatsApp shows the draft and the user decides to send. */
export function whatsappLink(text: string): string {
  return `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(text)}`;
}
