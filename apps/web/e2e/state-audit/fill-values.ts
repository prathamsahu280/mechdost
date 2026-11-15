/**
 * The value the audit types into a text field when a row asks for `form=filled`. Codes (phone, email, PIN,
 * GSTIN) are the same in both languages; the free text is an address, so on /hi it is typed in Devanagari
 * (a typed address is shown back on the page and the Hindi gate would count it as English otherwise).
 */
export function filledFieldValue(type: string, name: string, locale: 'en' | 'hi'): string {
  if (type === 'tel' || /phone|mobile/.test(name)) return '9876543210';
  if (type === 'email') return 'ravi.sahu@example.com';
  if (name.includes('pin')) return '492001';
  if (name.includes('gstin')) return '22ABVCS4888H1ZL';
  return locale === 'hi'
    ? 'प्लॉट 14, हनुमान मंदिर के पास, शंकर नगर मेन रोड'
    : 'Plot 14, Near Hanuman Mandir, Shankar Nagar Main Road';
}
