import type { Intent } from './intents';

/** Server-translated strings and localised links for the assistant (no i18n runtime in the browser). */
export interface AssistantCopy {
  launcher: string;
  title: string;
  subtitle: string;
  greeting: string;
  placeholder: string;
  send: string;
  close: string;
  you: string;
  bot: string;
  note: string;
  suggestionsLabel: string;
  suggestions: { intent: Exclude<Intent, 'fallback' | 'contact'>; label: string }[];
  answers: Record<Intent, { text: string; action?: { label: string; href: string; external?: boolean } }>;
}
