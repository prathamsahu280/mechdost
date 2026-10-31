import { Star } from 'lucide-react';

/**
 * Five stars with fractional fill (4.6 → the fifth star 60% filled). Purely visual: the caller provides the
 * accessible text (`label`), so screen readers hear "Rated 4.6 out of 5 by 128 customers", not five icons.
 */
export function StarRating({
  rating,
  label,
  size = 'sm',
}: {
  rating: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const px = size === 'lg' ? 'size-6' : size === 'md' ? 'size-5' : 'size-4';
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <span key={i} className={`relative inline-block ${px}`} aria-hidden="true">
            <Star className={`absolute inset-0 ${px} text-line-card`} fill="currentColor" strokeWidth={0} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={`${px} text-star`} fill="currentColor" strokeWidth={0} />
            </span>
          </span>
        );
      })}
    </span>
  );
}
