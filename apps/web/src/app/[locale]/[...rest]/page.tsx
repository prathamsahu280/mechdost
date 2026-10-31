import { notFound } from 'next/navigation';

/** Unknown paths under a locale render the localised not-found page (next-intl pattern). */
export default function CatchAll() {
  notFound();
}
