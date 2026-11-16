export type PayNote = 'paid' | 'cancelled' | 'failed' | 'unavailable' | 'not_confirmed' | 'expired';

/**
 * The payment note a quote page shows (QA pass 4, bug 4): once the server says the order is paid, every earlier
 * warning ("not confirmed yet", "failed") is stale, so one state is shown at a time.
 */
export function payNoteShown(note: PayNote | null, serverPaid: boolean): PayNote | null {
  return note !== null && serverPaid ? 'paid' : note;
}
