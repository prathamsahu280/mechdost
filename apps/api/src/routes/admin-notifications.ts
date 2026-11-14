import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityScopeFrom,
  NotFoundError,
  WHATSAPP_BUDGET_KEY,
  getGlobalSetting,
  listEmailTemplates,
  listNotificationTemplates,
  putGlobalSetting,
  queueEmailTest,
  resetEmailTemplate,
  saveEmailTemplate,
  saveNotificationTemplate,
  whatsAppUsage,
} from '@mechdost/db/repo';
import { istParts, istStartOfDay } from '@mechdost/shared/time';
import { WHATSAPP_TEMPLATES } from '@mechdost/shared/whatsapp';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin → Notifications (hard rule 8; user 2026-11-02: "all these options need to be with the admin too").
 * Staff with `notifications:manage` edit template text (en/hi) per event and channel, switch WhatsApp on/off per
 * event (an enabled template = on), set the monthly WhatsApp budget alert and see delivery + estimated cost.
 */
const Channel = z.enum(['inapp', 'email', 'sms', 'whatsapp', 'push']);
const Locale = z.enum(['en', 'hi']);

const Template = z
  .object({
    key: z.string(),
    channel: Channel,
    locale: Locale,
    subject: z.string().nullable(),
    body: z.string(),
    enabled: z.boolean(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi('NotificationTemplate');

const CatalogueEntry = z.object({
  key: z.string(),
  metaName: z.string(),
  category: z.string(),
  params: z.array(z.string()),
  audience: z.string(),
});

const TemplateList = z
  .object({ templates: z.array(Template), whatsappCatalogue: z.array(CatalogueEntry) })
  .openapi('NotificationTemplateList');

const TemplateSave = z
  .object({
    key: z
      .string()
      .regex(/^[a-z_]+\.[a-z_]+$/)
      .max(64),
    channel: Channel,
    locale: Locale,
    subject: z.string().max(200).nullable().optional(),
    body: z.string().min(1).max(4000),
    enabled: z.boolean(),
    /** null to create; the current version to edit (compare-and-set). */
    version: z.number().int().min(1).nullable(),
  })
  .strict()
  .openapi('NotificationTemplateSave');

const Usage = z
  .object({
    budgetPaise: z.number().int().nullable(),
    budgetVersion: z.number().int().nullable(),
    monthStart: z.string(),
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
    costPaise: z.number().int(),
    overBudget: z.boolean(),
    byCategory: z.array(
      z.object({ category: z.string(), billable: z.number().int(), costPaise: z.number().int() }),
    ),
  })
  .openapi('WhatsAppUsage');

const BudgetSave = z
  .object({
    budgetPaise: z.number().int().min(0).max(1_000_000_000),
    version: z.number().int().min(1).nullable(),
  })
  .strict()
  .openapi('WhatsAppBudgetSave');

const listTemplates = createRoute({
  method: 'get',
  path: '/admin/notifications/templates',
  tags: ['admin'],
  summary: 'Notification templates per event, channel and language, plus the WhatsApp template catalogue',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Templates', content: { 'application/json': { schema: TemplateList } } },
    ...errorResponses,
  },
});

const saveTemplate = createRoute({
  method: 'put',
  path: '/admin/notifications/templates',
  tags: ['admin'],
  summary: 'Create or edit a template (WhatsApp: no offer wording, exact {{n}} placeholders)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: TemplateSave } } } },
  responses: {
    200: {
      description: 'Saved',
      content: { 'application/json': { schema: z.object({ version: z.number().int() }) } },
    },
    409: { description: 'Stale version', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Template not allowed', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

const getUsage = createRoute({
  method: 'get',
  path: '/admin/notifications/whatsapp',
  tags: ['admin'],
  summary: 'WhatsApp delivery and estimated cost this month (IST) against the budget alert',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Usage', content: { 'application/json': { schema: Usage } } },
    ...errorResponses,
  },
});

const saveBudget = createRoute({
  method: 'put',
  path: '/admin/notifications/whatsapp/budget',
  tags: ['admin'],
  summary: 'Set the monthly WhatsApp budget alert (paise)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: BudgetSave } } } },
  responses: {
    200: {
      description: 'Saved',
      content: { 'application/json': { schema: z.object({ version: z.number().int() }) } },
    },
    409: { description: 'Stale version', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

const EmailRow = z
  .object({
    key: z.string(),
    locale: Locale,
    subject: z.string().nullable(),
    heading: z.string().nullable(),
    body: z.string(),
    buttonLabel: z.string().nullable(),
    enabled: z.boolean(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi('EmailTemplateRow');

const EmailSave = z
  .object({
    key: z.string().min(1).max(64),
    locale: Locale,
    subject: z.string().max(200).nullable(),
    heading: z.string().max(200).nullable(),
    body: z.string().max(4000).nullable(),
    buttonLabel: z.string().max(100).nullable(),
    enabled: z.boolean(),
    /** null to create; the current version to edit (compare-and-set). */
    version: z.number().int().min(1).nullable(),
  })
  .strict()
  .openapi('EmailTemplateSave');

const EmailTarget = z
  .object({ key: z.string().min(1).max(64), locale: Locale })
  .strict()
  .openapi('EmailTemplateTarget');

const EmailReset = EmailTarget.extend({ version: z.number().int().min(1) })
  .strict()
  .openapi('EmailTemplateReset');

const listEmails = createRoute({
  method: 'get',
  path: '/admin/notifications/emails',
  tags: ['admin'],
  summary: 'Saved email text overrides and on/off switches (no row = the code default, on)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Overrides',
      content: { 'application/json': { schema: z.object({ templates: z.array(EmailRow) }) } },
    },
    ...errorResponses,
  },
});

const saveEmail = createRoute({
  method: 'put',
  path: '/admin/notifications/emails',
  tags: ['admin'],
  summary: 'Save subject, heading, body and button label of an email in one language, and its on/off switch',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: EmailSave } } } },
  responses: {
    200: {
      description: 'Saved',
      content: { 'application/json': { schema: z.object({ version: z.number().int() }) } },
    },
    409: { description: 'Stale version', content: { 'application/json': { schema: ErrorSchema } } },
    422: { description: 'Text not allowed', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

const resetEmail = createRoute({
  method: 'post',
  path: '/admin/notifications/emails/reset',
  tags: ['admin'],
  summary: 'Back to the default text of an email in one language (the on/off switch is kept)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: EmailReset } } } },
  responses: {
    200: {
      description: 'Reset',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    409: { description: 'Stale version', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

const testEmail = createRoute({
  method: 'post',
  path: '/admin/notifications/emails/test',
  tags: ['admin'],
  summary: 'Send an email with sample data to your own verified address',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: EmailTarget } } } },
  responses: {
    200: {
      description: 'Queued',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    422: { description: 'No verified address', content: { 'application/json': { schema: ErrorSchema } } },
    ...errorResponses,
  },
});

function monthStartIst(now: Date): Date {
  const { year, month } = istParts(now);
  return istStartOfDay(`${String(year)}-${String(month).padStart(2, '0')}-01`);
}

export function adminNotificationRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/admin/notifications/*', authenticate(deps, cache));
  app.use(
    '/admin/notifications/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  // Staff actions need phone + email verified (spec 01), then the permission (spec 13).
  app.use('/admin/notifications/*', requireVerified);
  app.use('/admin/notifications/*', requirePermission('notifications:manage'));
  // Templates and the WhatsApp budget apply to every city, so a city-scoped grant cannot change them (review C6).
  app.use('/admin/notifications/*', async (c, next) => {
    if (!cityScopeFrom(c.get('auth').grants, 'notifications:manage').all)
      throw new NotFoundError('Not found');
    await next();
  });
  app.use(
    '/admin/notifications/emails/test',
    rateLimit(deps.rateLimiter, RATE_RULES.emailTest, (c) => c.get('auth').user.id),
  );
  return app
    .openapi(listTemplates, async (c) => {
      const templates = await listNotificationTemplates(deps.db);
      const whatsappCatalogue = Object.entries(WHATSAPP_TEMPLATES).map(([key, t]) => ({
        key,
        metaName: t.name,
        category: t.category,
        params: [...t.params],
        audience: t.audience,
      }));
      return c.json(
        {
          templates: templates.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() })),
          whatsappCatalogue,
        },
        200,
      );
    })
    .openapi(saveTemplate, async (c) => {
      const body = c.req.valid('json');
      const saved = await saveNotificationTemplate(deps.db, {
        key: body.key,
        channel: body.channel,
        locale: body.locale,
        body: body.body,
        subject: body.subject ?? null,
        enabled: body.enabled,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(saved, 200);
    })
    .openapi(listEmails, async (c) => {
      const templates = await listEmailTemplates(deps.db);
      return c.json(
        { templates: templates.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() })) },
        200,
      );
    })
    .openapi(saveEmail, async (c) => {
      const body = c.req.valid('json');
      const saved = await saveEmailTemplate(deps.db, {
        key: body.key,
        locale: body.locale,
        subject: body.subject,
        heading: body.heading,
        body: body.body,
        buttonLabel: body.buttonLabel,
        enabled: body.enabled,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(saved, 200);
    })
    .openapi(resetEmail, async (c) => {
      const body = c.req.valid('json');
      await resetEmailTemplate(deps.db, {
        key: body.key,
        locale: body.locale,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ ok: true as const }, 200);
    })
    .openapi(testEmail, async (c) => {
      const body = c.req.valid('json');
      await queueEmailTest(deps.db, {
        key: body.key,
        locale: body.locale,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ ok: true as const }, 200);
    })
    .openapi(getUsage, async (c) => {
      const monthStart = monthStartIst(new Date());
      const [usage, budget] = await Promise.all([
        whatsAppUsage(deps.db, { since: monthStart }),
        getGlobalSetting(deps.db, WHATSAPP_BUDGET_KEY),
      ]);
      const budgetPaise = typeof budget?.value === 'number' ? budget.value : null;
      return c.json(
        {
          budgetPaise,
          budgetVersion: budget?.version ?? null,
          monthStart: monthStart.toISOString(),
          sent: usage.sent,
          delivered: usage.delivered,
          read: usage.read,
          failed: usage.failed,
          costPaise: usage.costPaise,
          overBudget: budgetPaise !== null && usage.costPaise >= budgetPaise,
          byCategory: usage.byCategory,
        },
        200,
      );
    })
    .openapi(saveBudget, async (c) => {
      const body = c.req.valid('json');
      const saved = await putGlobalSetting(deps.db, {
        key: WHATSAPP_BUDGET_KEY,
        value: body.budgetPaise,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(saved, 200);
    });
}
