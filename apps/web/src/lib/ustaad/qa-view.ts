import { QUESTION_FILTERS, type QuestionFilter } from '@mechdost/shared/ustaad/dto/qa';

/** `?filter=` from the address bar; anything unknown is All (the API validates again). */
export function parseQuestionFilter(raw: string | undefined): QuestionFilter {
  return (QUESTION_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as QuestionFilter) : 'all';
}

/** The chip on a question card: Solved, New (nobody answered yet) or "N answers". */
export function questionChip(q: {
  status: string;
  answers: number;
}): { key: 'solved' } | { key: 'new' } | { key: 'answers'; n: number } {
  if (q.status === 'solved') return { key: 'solved' };
  if (q.answers === 0) return { key: 'new' };
  return { key: 'answers', n: q.answers };
}

/** A fresh idempotency key for one send (retries of the same send reuse it). */
export function newIdemKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
