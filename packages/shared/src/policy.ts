/**
 * Admin-editable policy pages (hard rule 8; spec 08 "Content"; Consumer Protection E-Commerce Rules and the DPDP
 * notice must stay current). A policy is a structured document stored like other site content (draft →
 * publish, per locale, optional city override). Plain text only: no HTML, no markup; blank lines separate
 * paragraphs. Official facts are written as placeholders (`{company}`, `{address}`, `{phone}`) and filled by
 * plain replacement at render time, so they stay in one place. Pure functions, no dependencies.
 */
import { clip, cleanLine } from './text';
// `policy.terms` (/terms) joined 2026-11-26 so the Ustaad Network rules are admin-editable like the other policies.
export const POLICY_KEYS = [
  'policy.privacy',
  'policy.returns',
  'policy.delivery',
  'policy.service',
  'policy.terms',
] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];

export const POLICY_TOKENS = ['company', 'address', 'phone'] as const;
export type PolicyToken = (typeof POLICY_TOKENS)[number];

export const POLICY_LIMITS = { title: 80, lead: 280, heading: 80, body: 2000, sections: 20 } as const;

export interface PolicySection {
  heading: string;
  body: string;
  /** One decorative emoji shown beside the heading (optional). */
  emoji?: string;
}

export interface PolicyDoc {
  title: string;
  lead: string;
  sections: PolicySection[];
  /** Date the text last changed in substance (YYYY-MM-DD), shown as "Last updated". */
  updatedOn: string;
}

export type PolicyProblem =
  'shape' | 'empty' | 'too_many_sections' | 'unknown_placeholder' | 'date' | 'emoji';

export function isPolicyKey(key: string): key is PolicyKey {
  return (POLICY_KEYS as readonly string[]).includes(key);
}

const line = cleanLine;

/** Paragraphs survive (blank line between them); everything else is cleaned like a single line. */
const paragraphs = (value: string, max: number) =>
  clip(
    value
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((p) => line(p, max))
      .filter(Boolean)
      .join('\n\n'),
    max,
  );

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Joiners and variation selectors combine with the emoji before them, so they sit outside a character class.
const EMOJI =
  /^\p{Extended_Pictographic}(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f){0,7}$/u;

function validDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function unknownPlaceholder(text: string): boolean {
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(POLICY_TOKENS as readonly string[]).includes(m[1] ?? '')) return true;
  }
  return false;
}

/** Clean and check a policy document from an editor. Returns the stored form or the first problem found. */
export function cleanPolicy(
  input: unknown,
): { ok: true; doc: PolicyDoc } | { ok: false; problem: PolicyProblem } {
  if (!isRecord(input) || !Array.isArray(input.sections)) return { ok: false, problem: 'shape' };
  const { title, lead, updatedOn, sections } = input;
  if (typeof title !== 'string' || typeof lead !== 'string' || typeof updatedOn !== 'string')
    return { ok: false, problem: 'shape' };
  if (sections.length > POLICY_LIMITS.sections) return { ok: false, problem: 'too_many_sections' };
  if (!validDate(updatedOn)) return { ok: false, problem: 'date' };
  const cleaned: PolicySection[] = [];
  for (const raw of sections) {
    if (!isRecord(raw) || typeof raw.heading !== 'string' || typeof raw.body !== 'string')
      return { ok: false, problem: 'shape' };
    const heading = line(raw.heading, POLICY_LIMITS.heading);
    const body = paragraphs(raw.body, POLICY_LIMITS.body);
    if (!heading || !body) return { ok: false, problem: 'empty' };
    const section: PolicySection = { heading, body };
    if (raw.emoji !== undefined && raw.emoji !== '') {
      if (typeof raw.emoji !== 'string' || !EMOJI.test(raw.emoji)) return { ok: false, problem: 'emoji' };
      section.emoji = raw.emoji;
    }
    cleaned.push(section);
  }
  const doc: PolicyDoc = {
    title: line(title, POLICY_LIMITS.title),
    lead: line(lead, POLICY_LIMITS.lead),
    sections: cleaned,
    updatedOn,
  };
  if (!doc.title || cleaned.length === 0) return { ok: false, problem: 'empty' };
  const texts = [doc.title, doc.lead, ...cleaned.flatMap((s) => [s.heading, s.body])];
  if (texts.some(unknownPlaceholder)) return { ok: false, problem: 'unknown_placeholder' };
  return { ok: true, doc };
}

/** Fill `{company}`, `{address}`, `{phone}` by plain replacement (never as a message format). */
export function fillPolicyText(text: string, facts: Record<PolicyToken, string>): string {
  return text.replace(/\{(company|address|phone)\}/g, (_, token: PolicyToken) => facts[token]);
}
