import type { ComparePrompt } from './prompt';

/** The tray's question wordings, translated on the server with `{to}`, `{from}` and `{count}` left in. */
export interface SwitchLabels {
  switchTitle: string;
  switchTitleNoName: string;
  switchOne: string;
  switchMany: string;
  switchOneNoName: string;
  switchManyNoName: string;
}

/** A stored name is used only in the language it was written in (never English on /hi). */
export function nameIn(name: string | undefined, lang: string | undefined, pageLang: string): string | null {
  return name && lang === pageLang ? name : null;
}

/**
 * "Start a new comparison with Batteries?" + "This removes 1 Lubricants item." (redesign 2026-11-14), falling back
 * to wordings without a name when a name is missing or in another language.
 */
export function switchText(
  prompt: Extract<ComparePrompt, { kind: 'switch' }>,
  labels: SwitchLabels,
  pageLang: string,
): { title: string; body: string } {
  const to = nameIn(prompt.name, prompt.lang, pageLang);
  const from = nameIn(prompt.fromName, prompt.fromLang, pageLang);
  const one = prompt.fromCount === 1;
  const body = from
    ? (one ? labels.switchOne : labels.switchMany).replace('{from}', () => from)
    : one
      ? labels.switchOneNoName
      : labels.switchManyNoName;
  return {
    title: to ? labels.switchTitle.replace('{to}', () => to) : labels.switchTitleNoName,
    body: body.replace('{count}', String(prompt.fromCount)),
  };
}
