/**
 * The "Genuine parts only" clause of the seller agreement (user 2026-11-15, Q102 "Yes"). DRAFT, pending legal review:
 * the full agreement text still comes from the user (Q77). The admin adds this clause to both language texts in
 * Admin -> Partners -> Agreement and publishes a new version, so it is part of the version a shop accepts. Both
 * languages live together here (not in the locale files) because the editor shows both at once, whatever the page
 * language. The consequence is the standing reason code `counterfeit_confirmed` (`partner-codes.ts`).
 */
export const GENUINE_CLAUSE = {
  en: {
    title: 'Genuine parts only',
    body: 'My shop lists only genuine products, legally sourced and in their original packaging. If MechDost confirms that a product I sold is fake or counterfeit, the product is taken off sale and my shop can be paused or suspended.',
  },
  hi: {
    title: 'केवल असली पार्ट्स',
    body: 'मेरी दुकान केवल असली उत्पाद सूचीबद्ध करेगी, जो कानूनी तरीके से लिए गए हों और अपनी मूल पैकिंग में हों। अगर MechDost पुष्टि करे कि मेरा बेचा हुआ कोई उत्पाद नकली है, तो वह उत्पाद बिक्री से हटा दिया जाएगा और मेरी दुकान को रोका या निलंबित किया जा सकता है।',
  },
} as const;

/** The clause as a block of agreement text (heading line, then the paragraph). */
export const genuineClauseText = (locale: 'en' | 'hi'): string =>
  `${GENUINE_CLAUSE[locale].title}\n${GENUINE_CLAUSE[locale].body}`;

/** `text` with the clause appended once: unchanged when it already has it, so adding twice never duplicates. */
export function withGenuineClause(text: string, locale: 'en' | 'hi'): string {
  const clause = genuineClauseText(locale);
  if (text.includes(clause)) return text;
  const trimmed = text.trimEnd();
  return trimmed === '' ? clause : `${trimmed}\n\n${clause}`;
}
