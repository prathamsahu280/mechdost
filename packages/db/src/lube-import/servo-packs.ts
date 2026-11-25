/**
 * Pack sizes of the Servo products, from the IndiaMART listings of the source folder where the listing's match
 * confidence is High (user ruling 2026-11-25: "pack sizes may come from listings only where Confidence is high").
 * Read from the `IndiaMART listings` sheet of `Servo_Lubricants.xlsx` (2026-11-25), keyed by the product name of the
 * products CSV. Listings of Medium or Low confidence, and listings with no pack size, add nothing; a product not listed
 * here has no known pack size (one "Standard pack"). Seller prices are asking prices, not MRPs, and are not used.
 */
export const SERVO_HIGH_CONFIDENCE_PACKS: Readonly<Record<string, readonly string[]>> = {
  'SERVO PREMIUM CF-4 15W-40': ['2.5 Litre', '20 Litre', '26 Litre', '210 Litre'],
  'SERVO PRIDE TC 15W-40': ['1 Litre'],
  'SERVO PRIDE XL 15W-40': ['210 Litre'],
  'SERVO RAFTAAR': ['15 Litre'],
  'SERVO 4T ZOOM': ['1 Litre'],
  'SERVO TRACTOR OIL 20W-40': ['7.5 Litre'],
  'SERVO GEAR SUPER 85W-140': ['200 Litre', '210 Litre'],
  'SERVO SUPER MG 5W-30/10W-30/10W-40/20W-40/20W-50': ['20 Litre', '210 Litre'],
  'SERVO Grease MP': ['20 Kg', '182 Kg'],
};
