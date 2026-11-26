import { z } from 'zod';
import en from './notify-templates/en.json';
import hi from './notify-templates/hi.json';
import {
  WHATSAPP_TEMPLATES,
  isWhatsAppTemplateKey,
  placeholderProblem,
  utilityTemplateProblem,
  type WhatsAppLocale,
  type WhatsAppTemplateKey,
} from './whatsapp';

/**
 * Meta WhatsApp Business Management API: what the template CLI (`pnpm wa:templates`) submits and reads, and the
 * rules Meta enforces on a template before it will review it (checked here so a dry run catches them first).
 * Template bodies are the `notify-templates/{en,hi}.json` files (the same text the admin sees in Notifications); the
 * button labels and sample values live here. Catalogue = `whatsapp.ts`; this file never invents a template.
 */

/** Site origin used in URL buttons; Meta needs a fixed https base with one `{{1}}` suffix. */
export const WHATSAPP_BUTTON_ORIGIN = 'https://mechdost.com';

export const META_CATEGORY = {
  utility: 'UTILITY',
  authentication: 'AUTHENTICATION',
  marketing: 'MARKETING',
} as const;
export type MetaCategory = (typeof META_CATEGORY)[keyof typeof META_CATEGORY];

export interface MetaBodyComponent {
  type: 'BODY';
  text: string;
  example: { body_text: string[][] };
}
export interface MetaUrlButton {
  type: 'URL';
  text: string;
  url: string;
  example: string[];
}
export interface MetaButtonsComponent {
  type: 'BUTTONS';
  buttons: MetaUrlButton[];
}
export interface MetaTemplatePayload {
  name: string;
  language: WhatsAppLocale;
  category: MetaCategory;
  components: (MetaBodyComponent | MetaButtonsComponent)[];
}

export interface BuiltMetaTemplate {
  key: WhatsAppTemplateKey;
  payload: MetaTemplatePayload;
}

/** Sample values Meta requires for every `{{n}}` (reviewers see them; they look like real codes). */
const SAMPLE: Record<string, string> = {
  orderCode: 'MD-RPR-2026-7K3QWX',
  requestCode: 'SR-RPR-2026-4H2MNP',
  ticketCode: 'REQ-RPR-2026-9D5TXA',
  quoteCode: 'QT-RPR-2026-8N3R4T',
  rsaCode: 'RSA-RPR-2026-6M4QZB',
  acceptMinutes: '10',
  minutes: '15',
  name: 'Ravi',
  hours: '72',
};

interface ButtonCopy {
  label: Record<WhatsAppLocale, string>;
  /** Path after the origin, ending in `{{1}}`. */
  path: string;
}

/** Button per catalogue entry with a `urlParam` (labels ≤ 25 characters). Partner templates have none. */
export const META_TEMPLATE_COPY: Record<WhatsAppTemplateKey, { button?: ButtonCopy }> = {
  'order.confirmed': {
    button: { label: { en: 'Track order', hi: 'ऑर्डर ट्रैक करें' }, path: '/orders/{{1}}' },
  },
  'order.out_for_delivery': {
    button: { label: { en: 'Track order', hi: 'ऑर्डर ट्रैक करें' }, path: '/orders/{{1}}' },
  },
  'order.rejected': { button: { label: { en: 'View order', hi: 'ऑर्डर देखें' }, path: '/orders/{{1}}' } },
  'service.estimate_sent': {
    button: { label: { en: 'Review estimate', hi: 'अनुमान देखें' }, path: '/service/{{1}}' },
  },
  'ticket.replied': {
    button: { label: { en: 'Open request', hi: 'रिक्वेस्ट खोलें' }, path: '/account/support?ticket={{1}}' },
  },
  'quote.offer_sent': {
    button: { label: { en: 'Review price', hi: 'कीमत देखें' }, path: '/quotes/{{1}}' },
  },
  'quote.message': { button: { label: { en: 'Read message', hi: 'संदेश पढ़ें' }, path: '/quotes/{{1}}' } },
  'quote.expiring': { button: { label: { en: 'Review quote', hi: 'कोटेशन देखें' }, path: '/quotes/{{1}}' } },
  'quote.withdrawn': { button: { label: { en: 'See reason', hi: 'कारण देखें' }, path: '/quotes/{{1}}' } },
  'rsa.accepted': {
    button: { label: { en: 'Track request', hi: 'अनुरोध ट्रैक करें' }, path: '/roadside/{{1}}' },
  },
  'rsa.arrived': {
    button: { label: { en: 'Track request', hi: 'अनुरोध ट्रैक करें' }, path: '/roadside/{{1}}' },
  },
  'rsa.bill_ready': {
    button: { label: { en: 'See bill', hi: 'बिल देखें' }, path: '/roadside/{{1}}' },
  },
  'rsa.refunded': {
    button: { label: { en: 'View request', hi: 'अनुरोध देखें' }, path: '/roadside/{{1}}' },
  },
  'rsa.offer': {},
  'order.routed': {},
  'delivery.offer': {},
  'delivery.agent_invite': {},
};

const BODIES: Record<
  WhatsAppLocale,
  {
    order: Record<string, string>;
    service: Record<string, string>;
    ticket: Record<string, string>;
    quote: Record<string, string>;
    rsa: Record<string, string>;
    delivery: Record<string, string>;
  }
> = {
  en,
  hi,
};

/** The locale-file text of a catalogue event, e.g. `order.confirmed` → `notifyTemplates.order.confirmed`. */
export function whatsAppBodyText(key: WhatsAppTemplateKey, locale: WhatsAppLocale): string {
  const [group, event] = key.split('.') as [
    'order' | 'service' | 'ticket' | 'quote' | 'rsa' | 'delivery',
    string,
  ];
  return BODIES[locale][group][event] ?? '';
}

export function buildMetaTemplates(): BuiltMetaTemplate[] {
  const out: BuiltMetaTemplate[] = [];
  for (const key of Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]) {
    const def: {
      name: string;
      category: keyof typeof META_CATEGORY;
      params: readonly string[];
      urlParam?: string;
    } = WHATSAPP_TEMPLATES[key];
    for (const language of ['en', 'hi'] as const) {
      const components: MetaTemplatePayload['components'] = [
        {
          type: 'BODY',
          text: whatsAppBodyText(key, language),
          example: { body_text: [def.params.map((p) => SAMPLE[p] ?? 'sample')] },
        },
      ];
      const button = META_TEMPLATE_COPY[key].button;
      if (def.urlParam && button) {
        const sample = SAMPLE[def.urlParam] ?? 'sample';
        components.push({
          type: 'BUTTONS',
          buttons: [
            {
              type: 'URL',
              text: button.label[language],
              url: `${WHATSAPP_BUTTON_ORIGIN}${button.path}`,
              example: [`${WHATSAPP_BUTTON_ORIGIN}${button.path.replace('{{1}}', sample)}`],
            },
          ],
        });
      }
      out.push({
        key,
        payload: { name: def.name, language, category: META_CATEGORY[def.category], components },
      });
    }
  }
  return out;
}

export type MetaProblem =
  | 'name_pattern'
  | 'body_missing'
  | 'body_too_long'
  | 'placeholder_numbering'
  | 'example_count'
  | 'param_at_edge'
  | 'promo_wording'
  | 'button_text_too_long'
  | 'button_url_too_long'
  | 'button_example';

/** Meta's template rules we can check offline. Empty array = ready to submit. */
export function metaTemplateProblems(p: MetaTemplatePayload): MetaProblem[] {
  const problems: MetaProblem[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(p.name)) problems.push('name_pattern');
  const body = p.components.find((c): c is MetaBodyComponent => c.type === 'BODY');
  if (!body || body.text.trim() === '') {
    problems.push('body_missing');
  } else {
    if (body.text.length > 1024) problems.push('body_too_long');
    const numbers = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const count = new Set(numbers).size;
    if (placeholderProblem(body.text, count) !== null || (count > 0 && Math.max(...numbers) !== count)) {
      problems.push('placeholder_numbering');
    }
    if ((body.example.body_text[0]?.length ?? 0) !== count) problems.push('example_count');
    if (/^\s*\{\{\d+\}\}/.test(body.text) || /\{\{\d+\}\}[\s.!?।]*$/.test(body.text))
      problems.push('param_at_edge');
    if (p.category === 'UTILITY' && utilityTemplateProblem(body.text) === 'promo_wording') {
      problems.push('promo_wording');
    }
  }
  for (const c of p.components) {
    if (c.type !== 'BUTTONS') continue;
    for (const b of c.buttons) {
      if (b.text.length > 25) problems.push('button_text_too_long');
      if (b.url.length > 2000) problems.push('button_url_too_long');
      if (b.url.includes('{{1}}') && b.example.length !== 1) problems.push('button_example');
    }
  }
  return problems;
}

const MetaTemplateRow = z.object({
  name: z.string(),
  language: z.string(),
  status: z.string(),
  category: z.string().optional(),
  id: z.string().optional(),
});
export type MetaTemplateRow = z.infer<typeof MetaTemplateRow>;

const MetaTemplateList = z.object({
  data: z.array(MetaTemplateRow),
  paging: z
    .object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() })
    .optional(),
});

/**
 * Parses a `GET /{waba}/message_templates` page; throws on a malformed body. `after` is the cursor for the next
 * page (null on the last page). Meta's `paging.next` URL embeds the access token, so it is never used or kept.
 */
export function parseMetaTemplateList(raw: unknown): { items: MetaTemplateRow[]; after: string | null } {
  const parsed = MetaTemplateList.parse(raw);
  const after = parsed.paging?.next ? (parsed.paging.cursors?.after ?? null) : null;
  return { items: parsed.data, after };
}

/** Catalogue templates (per language) that Meta does not have yet. Existing ones are never touched. */
export function missingTemplates(
  wanted: readonly BuiltMetaTemplate[],
  existing: readonly Pick<MetaTemplateRow, 'name' | 'language'>[],
): BuiltMetaTemplate[] {
  return wanted.filter(
    (w) => !existing.some((e) => e.name === w.payload.name && e.language === w.payload.language),
  );
}

export type WhatsAppTemplateStatuses = Partial<
  Record<WhatsAppTemplateKey, Partial<Record<WhatsAppLocale, string>>>
>;

/** Meta status per catalogue key and language (lower case). Templates the catalogue does not own are ignored. */
export function statusesByKey(
  rows: readonly (Pick<MetaTemplateRow, 'name' | 'language' | 'status'> & { category?: string })[],
): WhatsAppTemplateStatuses {
  const out: Record<string, Partial<Record<WhatsAppLocale, string>>> = {};
  const keyByName = new Map<string, WhatsAppTemplateKey>(
    (Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]).map((k) => [WHATSAPP_TEMPLATES[k].name, k]),
  );
  for (const r of rows) {
    const key = keyByName.get(r.name);
    if (!key || (r.language !== 'en' && r.language !== 'hi')) continue;
    (out[key] ??= {})[r.language] = r.status.toLowerCase();
  }
  return out;
}

/** Stored shape of `notifications.whatsapp_template_status` (written by `pnpm wa:templates --status --save`). */
export const WhatsAppStatusSetting = z.object({
  syncedAt: z.string(),
  templates: z.record(z.string(), z.record(z.string(), z.string())),
});
export type WhatsAppStatusSetting = z.infer<typeof WhatsAppStatusSetting>;

/**
 * Send gate: before the first status sync everything stays admin-switch only (no change in behaviour); after it,
 * only templates Meta reports `approved` for that language may be queued.
 */
export function whatsAppTemplateApproved(
  statuses: WhatsAppTemplateStatuses | Readonly<Record<string, Readonly<Record<string, string>>>> | null,
  key: string,
  locale: WhatsAppLocale,
): boolean {
  if (statuses === null) return true;
  if (!isWhatsAppTemplateKey(key)) return false;
  const byKey = statuses as Readonly<Record<string, Readonly<Partial<Record<string, string>>> | undefined>>;
  return byKey[key]?.[locale] === 'approved';
}
