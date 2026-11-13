/**
 * The demo's single city (multi-city lives in the API: every PIN maps to a city and a state). The checkout uses
 * `gstStateCode` for the place-of-supply note; on the API the quote returns `deliveryStateCode` per PIN.
 */
export const DEMO_CITY = { code: 'RPR', gstStateCode: '22' } as const;
