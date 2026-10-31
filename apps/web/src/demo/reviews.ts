/**
 * DEMO REVIEWS (decision 2026-11-01 "Demo mode"). Deterministic ratings and sample reviews per product and workshop
 * so pages are stable between loads. Real reviews come from `reviews` (admin-approved, spec 08) via the API.
 */
import type { CategoryKey, DemoProduct } from './catalogue';
import type { DemoWorkshop } from './workshops';

export interface SeedReview {
  id: string;
  name: string;
  area: string;
  rating: number;
  title: string;
  body: string;
  date: string;
  verified: boolean;
}

export interface RatingSummary {
  rating: number;
  count: number;
  /** Counts for 5, 4, 3, 2, 1 stars. */
  distribution: [number, number, number, number, number];
}

/** Small stable hash so every slug gets the same numbers on server and client. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Split `count` reviews into star buckets whose average is close to `rating`. */
export function distributionFor(rating: number, count: number): RatingSummary['distribution'] {
  const fiveShare = Math.max(0.35, Math.min(0.85, (rating - 3.4) / 1.6));
  const shares = [
    fiveShare,
    (1 - fiveShare) * 0.62,
    (1 - fiveShare) * 0.2,
    (1 - fiveShare) * 0.1,
    (1 - fiveShare) * 0.08,
  ];
  const [s5, s4, s3, s2, s1] = shares.map((s) => Math.floor(s * count)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  // Rounding leftovers go to five stars so the buckets always add up to `count`.
  const five = s5 + (count - (s5 + s4 + s3 + s2 + s1));
  return [five, s4, s3, s2, s1];
}

export function productRating(product: DemoProduct): RatingSummary {
  const h = hash(product.slug);
  const rating = Math.round((4.1 + (h % 8) / 10) * 10) / 10;
  const count = (product.popular ? 120 : 14) + (h % 140);
  return { rating, count, distribution: distributionFor(rating, count) };
}

export function workshopRating(workshop: DemoWorkshop): RatingSummary {
  return {
    rating: workshop.rating,
    count: workshop.reviews,
    distribution: distributionFor(workshop.rating, workshop.reviews),
  };
}

const PEOPLE = [
  ['Ravi S.', 'Shankar Nagar'],
  ['Pooja T.', 'Telibandha'],
  ['Amit V.', 'Devendra Nagar'],
  ['Neha G.', 'Pandri'],
  ['Sanjay K.', 'Tatibandh'],
  ['Priya M.', 'Mowa'],
  ['Arjun D.', 'Amapara'],
  ['Kavita R.', 'Sarona'],
] as const;

const PRODUCT_POOL: Record<CategoryKey | 'default', [number, string, string][]> = {
  tyres: [
    [
      5,
      'Good grip in the rain',
      'Fitted at the partner workshop the next day. Handling feels much better on wet roads.',
    ],
    [
      4,
      'Right size, quick delivery',
      'MechDost checked the size with my vehicle model before sending it. Fair price.',
    ],
    [5, 'Smooth and quiet', 'Noticeably quieter than my old tyres on the highway to Bilaspur.'],
  ],
  lubricants: [
    [5, 'Genuine pack', 'Seal intact, batch number printed. Engine sounds smoother after the change.'],
    [4, 'Good value', 'Cheaper than the shop near my house and delivered the same day.'],
    [5, 'Easy order', 'Ordered for my Splendor, team confirmed the grade on call. Recommended.'],
  ],
  batteries: [
    [5, 'Starts first time every morning', 'Fresh stock with this month’s date. Old battery was taken back.'],
    [4, 'Installation was quick', 'The workshop fitted it in 15 minutes. Warranty card filled correctly.'],
    [5, 'Reliable', 'Three months in, no issues even with the AC running in traffic.'],
  ],
  bearings: [
    [4, 'Correct part', 'Team confirmed the part number before ordering. Noise is gone.'],
    [5, 'Quality bearing', 'Well packed and genuine. Mechanic was happy with it.'],
  ],
  filters: [
    [5, 'Exact fit', 'Matched the OEM number. Delivered with my oil order.'],
    [4, 'Does the job', 'Good filtration, reasonable price.'],
  ],
  spareParts: [
    [5, 'Brakes feel new', 'Pads fitted at a MechDost workshop. Braking is firm again.'],
    [4, 'Original quality', 'Packaging was good and the part matched exactly.'],
    [5, 'Saved me a trip', 'Ordered in the morning, got it by evening in Raipur.'],
  ],
  accessories: [
    [4, 'Fits well', 'Good material, fits my hatchback nicely.'],
    [5, 'Nice quality', 'Better than the ones sold at the roadside.'],
  ],
  workshopTools: [
    [5, 'Solid set', 'Sockets feel sturdy and the case is well made.'],
    [4, 'Accurate', 'Readings match the petrol pump gauge. Handy to keep in the car.'],
  ],
  evEssentials: [
    [5, 'Team was helpful', 'They confirmed compatibility with my car before ordering. Works perfectly.'],
    [4, 'Good backup', 'Charges reliably; took a few days for delivery.'],
  ],
  default: [[5, 'Happy with the purchase', 'Delivered on time and exactly as described.']],
};

const WORKSHOP_POOL: [number, string, string][] = [
  [
    5,
    'Clear estimate, no surprises',
    'They sent the estimate line by line and only did what I approved. Bill matched exactly.',
  ],
  [5, 'Quick and honest', 'Told me the clutch was fine and only the cable needed adjusting. Saved money.'],
  [
    4,
    'Good service, slight delay',
    'Work was good. Took an hour longer than promised but they kept me updated.',
  ],
  [5, 'Pickup was convenient', 'They picked up my scooter from home and dropped it back washed.'],
  [4, 'Friendly mechanics', 'Explained everything in Hindi, showed me the old parts.'],
];

function pick<T>(list: readonly T[], seed: number, n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.min(n, list.length); i++) {
    const item = list[(seed + i) % list.length];
    if (item !== undefined) out.push(item);
  }
  return out;
}

function daysAgo(n: number): string {
  return new Date(Date.UTC(2026, 9, 30) - n * 86_400_000).toISOString();
}

export function productReviews(product: DemoProduct): SeedReview[] {
  const h = hash(product.slug);
  const pool =
    PRODUCT_POOL[product.category].length > 0 ? PRODUCT_POOL[product.category] : PRODUCT_POOL.default;
  return pick(pool, h, 3).map(([rating, title, body], i) => {
    const [name, area] = PEOPLE[(h + i * 3) % PEOPLE.length] ?? PEOPLE[0];
    return {
      id: `${product.slug}-${i}`,
      name,
      area,
      rating,
      title,
      body,
      date: daysAgo(3 + i * 9 + (h % 5)),
      verified: true,
    };
  });
}

export function workshopReviews(workshop: DemoWorkshop): SeedReview[] {
  const h = hash(workshop.slug);
  return pick(WORKSHOP_POOL, h, 3).map(([rating, title, body], i) => {
    const [name, area] = PEOPLE[(h + i * 5) % PEOPLE.length] ?? PEOPLE[0];
    return {
      id: `${workshop.slug}-${i}`,
      name,
      area,
      rating,
      title,
      body,
      date: daysAgo(2 + i * 11 + (h % 4)),
      verified: true,
    };
  });
}
