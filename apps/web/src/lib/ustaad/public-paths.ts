/**
 * `/ustaad` pages shown outside the network's gate and shell (workstream D web): only the share teaser
 * `/ustaad/s/{token}` (SR-44). Canonical paths (no `/hi` prefix).
 */
const TEASER = /^\/ustaad\/s\/[A-Za-z0-9_.-]{1,200}$/;

export function isUstaadPublicPath(canonical: string): boolean {
  return TEASER.test(canonical);
}
