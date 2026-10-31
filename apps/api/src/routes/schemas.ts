import { z } from '@hono/zod-openapi';

/** Shared OpenAPI schemas. Request DTOs are `.strict()` — unknown fields are rejected (no mass assignment). */
export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'AUTH_REQUIRED' }),
      message: z.string(),
      requestId: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('Error');

export const errorResponses = {
  400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  401: {
    description: 'Not signed in or token invalid',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorSchema } } },
  429: { description: 'Rate limited', content: { 'application/json': { schema: ErrorSchema } } },
} as const;
