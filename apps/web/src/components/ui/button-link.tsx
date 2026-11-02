import { ArrowUpRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { LocalLink } from './local-link';

const VARIANTS = {
  primary: 'bg-accent-button text-white hover:bg-accent-button-hover',
  outlineOnDark: 'border border-white/40 text-white hover:bg-white/10',
  /** Primary action on deep-green panels: white pill, green label (7.1:1). */
  onGreen: 'bg-white text-accent-button shadow-card hover:bg-accent-soft',
  whatsapp: 'bg-whatsapp text-white hover:brightness-95',
  quiet: 'text-ink underline-offset-4 hover:underline px-0',
} as const;

type Variant = keyof typeof VARIANTS;

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-button px-5 text-sm font-bold transition-colors duration-200';

function Label({ children, arrow }: { children: ReactNode; arrow: boolean }) {
  return (
    <>
      <span>{children}</span>
      {arrow ? <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.5} /> : null}
    </>
  );
}

/** Locale-aware internal link styled as a button (concept: 9px radius, bold, ↗ arrow). */
export function ButtonLink({
  variant = 'primary',
  arrow = true,
  className = '',
  children,
  ...props
}: ComponentProps<typeof LocalLink> & { variant?: Variant; arrow?: boolean }) {
  return (
    <LocalLink {...props} className={`${base} ${VARIANTS[variant]} ${className}`}>
      <Label arrow={arrow}>{children}</Label>
    </LocalLink>
  );
}

/** External link (WhatsApp, phone) styled as a button; `note` is read by screen readers only. */
export function ExternalButtonLink({
  variant = 'primary',
  arrow = true,
  note,
  className = '',
  children,
  ...props
}: ComponentProps<'a'> & { variant?: Variant; arrow?: boolean; note?: string }) {
  return (
    <a {...props} className={`${base} ${VARIANTS[variant]} ${className}`}>
      <Label arrow={arrow}>{children}</Label>
      {note ? <span className="sr-only"> ({note})</span> : null}
    </a>
  );
}
