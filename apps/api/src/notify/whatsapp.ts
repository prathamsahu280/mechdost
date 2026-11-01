import {
  WHATSAPP_TEMPLATES,
  classifyWhatsAppError,
  isWhatsAppTemplateKey,
  toWhatsAppNumber,
  whatsAppParamProblem,
} from '@mechdost/shared/whatsapp';
import type { OutboxRow } from '@mechdost/db/repo';
import { ChannelError, type ChannelAdapter } from './dispatcher';

/**
 * Meta WhatsApp Cloud API, called directly (decision 2026-11-02: cheapest, no provider markup).
 * POST https://graph.facebook.com/{version}/{phone-number-id}/messages with a System User token (Secret Manager).
 * Only approved templates are sent from here; free-form replies inside the 24 h window come with the ticket bridge.
 */
export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}

interface GraphError {
  error?: { code?: number; error_subcode?: number; message?: string };
}

interface GraphSend {
  messages?: { id?: string }[];
}

export function createWhatsAppAdapter(
  cfg: WhatsAppConfig,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): ChannelAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;

  return {
    channel: 'whatsapp',
    async send(row: OutboxRow) {
      if (!isWhatsAppTemplateKey(row.templateKey)) throw new ChannelError('permanent', 'unknown_template');
      const template = WHATSAPP_TEMPLATES[row.templateKey];
      const to = row.recipient ? toWhatsAppNumber(row.recipient) : null;
      if (!to) throw new ChannelError('permanent', 'bad_recipient');
      const values: string[] = [];
      for (const key of template.params) {
        const raw = row.payload[key];
        const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
        if (whatsAppParamProblem(value)) throw new ChannelError('permanent', `bad_param_${key}`);
        values.push(value);
      }
      const components: unknown[] = [
        { type: 'body', parameters: values.map((text) => ({ type: 'text', text })) },
      ];
      if ('urlParam' in template) {
        const rawSuffix = row.payload[template.urlParam];
        const suffix = typeof rawSuffix === 'string' ? rawSuffix : '';
        if (whatsAppParamProblem(suffix)) throw new ChannelError('permanent', 'bad_url_param');
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: suffix }],
        });
      }

      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: { name: template.name, language: { code: row.locale }, components },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        });
      } catch {
        throw new ChannelError('retry', 'network');
      }
      const body = (await res.json().catch(() => ({}))) as GraphError & GraphSend;
      if (!res.ok) {
        const code = body.error?.code;
        throw new ChannelError(classifyWhatsAppError(code, res.status), `meta_${String(code ?? res.status)}`);
      }
      const id = body.messages?.[0]?.id;
      if (!id) throw new ChannelError('retry', 'meta_no_id');
      return { providerId: id };
    },
  };
}
