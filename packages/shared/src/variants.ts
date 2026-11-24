/**
 * Sizes of a product (user, 2026-11-24: tyres are one product per tread pattern, each size a variant, "like
 * 500 ml and 1 L"). One label for a variant, built from its `options`, used by the API, the web and the order
 * snapshot; and the private fitment match behind "Fits your vehicle".
 */

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** "145/70 R12 69T TL": size, then load index + speed rating, then TL/TT, each only when the size lacks it. */
export function variantLabel(options: Readonly<Record<string, unknown>>): string {
  const size = text(options.size);
  if (size) {
    const parts = [size];
    const rating = `${text(options.loadIndex)}${text(options.speedRating)}`;
    if (rating && !size.toUpperCase().includes(rating.toUpperCase())) parts.push(rating);
    const tl = text(options.tlTt);
    if (tl && !new RegExp(`(^|\\s)${tl}(\\s|$)`, 'i').test(size)) parts.push(tl);
    return parts.join(' ');
  }
  const label = text(options.label) || text(options.model);
  if (label) return label;
  return Object.values(options).map(text).filter(Boolean).join(' ');
}

export interface TyreFitLine {
  vehicleType: string;
  make: string;
  model: string;
}

const TYPE_OF: Readonly<Record<string, string>> = {
  car: '4W',
  car_suv: '4W',
  motorcycle: '2W',
  scooter: '2W',
  two_wheeler: '2W',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does a saved vehicle (type, make, model) appear in a size's fitment list? Years are not compared. */
export function fitsFitment(
  fitment: readonly TyreFitLine[],
  vehicle: { type: string; make: string; model: string },
): boolean {
  const make = norm(vehicle.make);
  const model = norm(vehicle.model);
  if (!make || !model) return false;
  return fitment.some(
    (f) => TYPE_OF[f.vehicleType] === vehicle.type && norm(f.make) === make && norm(f.model) === model,
  );
}
