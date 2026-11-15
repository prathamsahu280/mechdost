/** Time left on a shop offer, split for the `portal.expiresIn` ICU message (hours + minutes, never "1440 min"). */
export function offerLeftParams(totalMinutes: number): { hours: number; mins: number } {
  const total = Math.max(0, Math.floor(totalMinutes));
  return { hours: Math.floor(total / 60), mins: total % 60 };
}
