/**
 * DEMO WORKSHOPS (decision 2026-11-01 "Demo mode"). Fictional workshops placed in real Raipur localities so the
 * location-first finder (spec 06) can be presented. Replaced by `GET /v1/workshops/nearby` (PostGIS ST_DWithin).
 */
import type { VehicleType } from '@mechdost/shared/vehicles';

export type { VehicleType };

export interface DemoService {
  key: string;
  name: string;
  minPaise: number;
  maxPaise: number;
  duration: string;
  /** `any`: every vehicle type the workshop serves. */
  vehicle: VehicleType | 'any';
  included: string;
}

export interface DemoWorkshop {
  slug: string;
  name: string;
  area: string;
  address: string;
  pincode: string;
  lat: number;
  lng: number;
  vehicles: VehicleType[];
  ev: boolean;
  pickup: boolean;
  rating: number;
  reviews: number;
  hours: string;
  checkedOn: string;
  services: DemoService[];
}

const S = {
  diagnosis: {
    key: 'diagnosis',
    name: 'Inspection & diagnosis',
    minPaise: 25_000,
    maxPaise: 70_000,
    duration: '30–60 min',
    vehicle: 'any',
    included: 'Road test, scanner check where available, written findings.',
  },
  routine2w: {
    key: 'routine2w',
    name: 'General service (2W)',
    minPaise: 80_000,
    maxPaise: 150_000,
    duration: '2–3 h',
    vehicle: '2W',
    included: 'Labour, chain adjustment, brake and tyre check. Oil and parts billed separately.',
  },
  routine4w: {
    key: 'routine4w',
    name: 'Periodic service (4W)',
    minPaise: 180_000,
    maxPaise: 350_000,
    duration: '3–4 h',
    vehicle: '4W',
    included: 'Labour, 25-point check, top-ups. Oil, filters and parts billed separately.',
  },
  oil: {
    key: 'oil',
    name: 'Engine oil & filter change',
    minPaise: 25_000,
    maxPaise: 60_000,
    duration: '30–45 min',
    vehicle: 'any',
    included: 'Labour only; bring your oil or buy it from MechDost.',
  },
  brakes: {
    key: 'brakes',
    name: 'Brake inspection & service',
    minPaise: 25_000,
    maxPaise: 60_000,
    duration: '45 min',
    vehicle: 'any',
    included: 'Pad/shoe check, cleaning and adjustment.',
  },
  battery: {
    key: 'battery',
    name: 'Battery & starting check',
    minPaise: 20_000,
    maxPaise: 50_000,
    duration: '20–30 min',
    vehicle: 'any',
    included: 'Load test, terminal cleaning, charging-system check.',
  },
  tyres: {
    key: 'tyres',
    name: 'Tyre fitting & inspection',
    minPaise: 15_000,
    maxPaise: 40_000,
    duration: '20–40 min',
    vehicle: 'any',
    included: 'Fitting, pressure check, puncture inspection.',
  },
  ac: {
    key: 'ac',
    name: 'AC inspection & cleaning',
    minPaise: 35_000,
    maxPaise: 120_000,
    duration: '45–90 min',
    vehicle: '4W',
    included: 'Cooling check, filter cleaning; gas refill quoted separately.',
  },
  alignment: {
    key: 'alignment',
    name: 'Wheel alignment & balancing',
    minPaise: 60_000,
    maxPaise: 110_000,
    duration: '45–60 min',
    vehicle: '4W',
    included: 'Computerised alignment and four-wheel balancing.',
  },
  ev: {
    key: 'ev',
    name: 'EV basic inspection',
    minPaise: 50_000,
    maxPaise: 90_000,
    duration: '45 min',
    vehicle: 'any',
    included: 'Battery health readout, brakes, tyres, charging port check.',
  },
  wash: {
    key: 'wash',
    name: 'Wash & interior clean',
    minPaise: 30_000,
    maxPaise: 90_000,
    duration: '1–2 h',
    vehicle: 'any',
    included: 'Foam wash, vacuum, dashboard polish.',
  },
} satisfies Record<string, DemoService>;

export const DEMO_WORKSHOPS: readonly DemoWorkshop[] = [
  {
    slug: 'pachpedi-naka-two-wheeler-care',
    name: 'Pachpedi Naka Two-Wheeler Care',
    area: 'Pachpedi Naka',
    address: 'Near Pachpedi Naka Chowk, Raipur',
    pincode: '492001',
    lat: 21.2271,
    lng: 81.6402,
    vehicles: ['2W'],
    ev: false,
    pickup: true,
    rating: 4.7,
    reviews: 128,
    hours: '9:00 – 20:00 · Mon–Sat',
    checkedOn: '2026-10-24',
    services: [S.diagnosis, S.routine2w, S.oil, S.brakes, S.battery, S.tyres],
  },
  {
    slug: 'telibandha-car-clinic',
    name: 'Telibandha Car Clinic',
    area: 'Telibandha',
    address: 'GE Road, Telibandha, Raipur',
    pincode: '492006',
    lat: 21.2443,
    lng: 81.6619,
    vehicles: ['4W'],
    ev: false,
    pickup: true,
    rating: 4.6,
    reviews: 94,
    hours: '9:30 – 19:30 · Mon–Sun',
    checkedOn: '2026-10-22',
    services: [S.diagnosis, S.routine4w, S.oil, S.brakes, S.ac, S.alignment, S.wash],
  },
  {
    slug: 'shankar-nagar-auto-hub',
    name: 'Shankar Nagar Auto Hub',
    area: 'Shankar Nagar',
    address: 'Main Road, Shankar Nagar, Raipur',
    pincode: '492007',
    lat: 21.2537,
    lng: 81.6551,
    vehicles: ['2W', '4W'],
    ev: true,
    pickup: false,
    rating: 4.5,
    reviews: 211,
    hours: '9:00 – 21:00 · Mon–Sat',
    checkedOn: '2026-10-20',
    services: [S.diagnosis, S.routine2w, S.routine4w, S.oil, S.battery, S.ev, S.tyres],
  },
  {
    slug: 'devendra-nagar-motors',
    name: 'Devendra Nagar Motors Service',
    area: 'Devendra Nagar',
    address: 'Sector 2, Devendra Nagar, Raipur',
    pincode: '492004',
    lat: 21.2638,
    lng: 81.6316,
    vehicles: ['4W'],
    ev: false,
    pickup: true,
    rating: 4.4,
    reviews: 67,
    hours: '10:00 – 19:00 · Mon–Sat',
    checkedOn: '2026-10-18',
    services: [S.diagnosis, S.routine4w, S.brakes, S.ac, S.alignment],
  },
  {
    slug: 'tatibandh-multi-brand-garage',
    name: 'Tatibandh Multi-Brand Garage',
    area: 'Tatibandh',
    address: 'Near Tatibandh Chowk, Raipur',
    pincode: '492099',
    lat: 21.2405,
    lng: 81.5943,
    vehicles: ['2W', '4W'],
    ev: false,
    pickup: false,
    rating: 4.3,
    reviews: 152,
    hours: '8:30 – 20:30 · Mon–Sun',
    checkedOn: '2026-10-25',
    services: [S.diagnosis, S.routine2w, S.routine4w, S.oil, S.brakes, S.tyres, S.wash],
  },
  {
    slug: 'mowa-ev-and-bike-point',
    name: 'Mowa EV & Bike Point',
    area: 'Mowa',
    address: 'Mowa Main Road, Raipur',
    pincode: '492007',
    lat: 21.2802,
    lng: 81.6687,
    vehicles: ['2W', '3W'],
    ev: true,
    pickup: true,
    rating: 4.8,
    reviews: 58,
    hours: '9:00 – 19:00 · Mon–Sat',
    checkedOn: '2026-10-27',
    services: [S.diagnosis, S.routine2w, S.battery, S.ev, S.tyres],
  },
  {
    slug: 'amapara-express-service',
    name: 'Amapara Express Service',
    area: 'Amapara',
    address: 'Amapara Chowk, Raipur',
    pincode: '492001',
    lat: 21.2318,
    lng: 81.6271,
    vehicles: ['2W', '4W'],
    ev: false,
    pickup: false,
    rating: 4.2,
    reviews: 83,
    hours: '9:00 – 20:00 · Mon–Sat',
    checkedOn: '2026-10-19',
    services: [S.diagnosis, S.oil, S.brakes, S.battery, S.tyres],
  },
  {
    slug: 'sarona-car-care',
    name: 'Sarona Car Care',
    area: 'Sarona',
    address: 'Sarona, near Salasar Greens, Raipur',
    pincode: '492099',
    lat: 21.2196,
    lng: 81.6006,
    vehicles: ['4W'],
    ev: true,
    pickup: true,
    rating: 4.6,
    reviews: 41,
    hours: '9:30 – 19:00 · Mon–Sat',
    checkedOn: '2026-10-28',
    services: [S.diagnosis, S.routine4w, S.ac, S.ev, S.wash],
  },
];

export function findWorkshop(slug: string): DemoWorkshop | undefined {
  return DEMO_WORKSHOPS.find((w) => w.slug === slug);
}

/** Raipur PIN centroids (demo) — the real build geocodes via the chosen provider (inbox Q12). */
export const PIN_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  '492001': { lat: 21.2292, lng: 81.6338 },
  '492004': { lat: 21.2638, lng: 81.6316 },
  '492006': { lat: 21.2443, lng: 81.6619 },
  '492007': { lat: 21.2601, lng: 81.6612 },
  '492099': { lat: 21.2296, lng: 81.5975 },
};

/** Great-circle distance in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function fromPricePaise(w: DemoWorkshop): number {
  return Math.min(...w.services.map((s) => s.minPaise));
}
