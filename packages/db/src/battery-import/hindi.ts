/**
 * Hindi words the Exide and Amaron importers share (hard rule 10): the fuel and start words of a fitment list and the
 * terminal side. Brand, range and model names stay in Latin script (`packages/shared/src/catalogue-hindi.ts`).
 */
export const FUEL_EN: Readonly<Record<string, string>> = {
  diesel: 'Diesel',
  petrol: 'Petrol',
  cng: 'CNG',
  lpg: 'LPG',
  ev: 'EV',
  hybrid: 'Hybrid',
  electric_start: 'Electric start',
  kick_start: 'Kick start',
};

export const FUEL_HI: Readonly<Record<string, string>> = {
  diesel: 'डीज़ल',
  petrol: 'पेट्रोल',
  cng: 'CNG',
  lpg: 'LPG',
  ev: 'EV',
  hybrid: 'हाइब्रिड',
  electric_start: 'सेल्फ़ स्टार्ट',
  kick_start: 'किक स्टार्ट',
};

/** The source's "Fuel / start type" as a code (`null` = blank or not understood). */
export function fuelCode(raw: string): string | null {
  switch (raw.trim().toUpperCase()) {
    case 'DIESEL':
      return 'diesel';
    case 'PETROL':
      return 'petrol';
    case 'CNG':
      return 'cng';
    case 'LPG':
      return 'lpg';
    case 'EV':
      return 'ev';
    case 'ES':
      return 'electric_start';
    case 'KS':
      return 'kick_start';
    default:
      return /^HYBRID\b/.test(raw.trim().toUpperCase()) ? 'hybrid' : null;
  }
}

export const TERMINAL_HI: Readonly<Record<string, string>> = { left: 'बायाँ', right: 'दायाँ' };
export const TERMINAL_EN: Readonly<Record<string, string>> = { left: 'Left', right: 'Right' };

/** "24 महीने"-style month count. */
export const monthsHi = (n: number) => `${String(n)} महीने`;
