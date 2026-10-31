import type { ReactNode } from 'react';

/** Re-mounts on every navigation: a short, CSS-only entrance so route changes feel continuous (spec 16: no JS cost). */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
