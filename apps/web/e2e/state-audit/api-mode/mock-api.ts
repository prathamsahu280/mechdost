/**
 * The mocked MechDost API of the API-mode audit: every `/v1/*` request from the page is answered here, from the
 * typed fixtures of `fixtures.ts`. A 2xx body is parsed with the same shared Zod schema the screen parses with, so a
 * fixture that drifts from the contract throws and the test fails with the schema's message (hard rule 4: the
 * fixture is not allowed to be friendlier than the API). A request nobody mocked is recorded and fails the case,
 * except on navigation walks, where one answer-all fallback keeps unrelated screens from failing a walk.
 */
import type { Page, Route } from '@playwright/test';
import type { AuditCase } from '../cases.ts';
import { AUDIT_API_ORIGIN } from './session.ts';

export interface Reply {
  status?: number;
  /** A 2xx body (parsed with the mock's schema) or, for an error status, the error code. */
  body?: unknown;
  code?: string;
  /** A binary body (the photo images): base64 and its content type. Skips the schema check. */
  raw?: { contentType: string; base64: string };
}

export interface MockCtx {
  c: AuditCase;
  method: string;
  /** The path after `/v1`, without the query. */
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface Mock {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: RegExp;
  /** A shared Zod schema (or anything with `parse`) the body must satisfy. */
  schema?: { parse(value: unknown): unknown };
  reply(ctx: MockCtx): Reply;
}

export interface ApiProblems {
  /** What went wrong in the mock layer (unmocked call, fixture that breaks its schema). */
  list: string[];
  /** Error statuses were intended: the browser's "Failed to load resource" console lines are not findings. */
  expectsErrors: boolean;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

const errorBody = (code: string) => ({ error: { code, message: code } });

export async function installApi(page: Page, c: AuditCase, mocks: readonly Mock[]): Promise<ApiProblems> {
  const problems: ApiProblems = { list: [], expectsErrors: false };
  const walking = c.state.walk === 'yes';
  await page.route(`${AUDIT_API_ORIGIN}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/v1/, '');
    const method = req.method();
    const mock = mocks.find((m) => m.method === method && m.path.test(path));
    if (!mock) {
      if (path === '/events') return route.fulfill({ status: 202, headers: CORS, json: { accepted: 0 } });
      if (!walking) problems.list.push(`unmocked API call: ${method} ${path}`);
      problems.expectsErrors = true;
      return route.fulfill({ status: 501, headers: CORS, json: errorBody('NOT_MOCKED') });
    }
    let body: unknown;
    try {
      body = req.postData() ? JSON.parse(req.postData() ?? 'null') : null;
    } catch {
      body = null;
    }
    const reply = mock.reply({ c, method, path, query: url.searchParams, body });
    const status = reply.status ?? 200;
    if (reply.raw && status < 400)
      return route.fulfill({
        status,
        headers: {
          ...CORS,
          'content-type': reply.raw.contentType,
          'cross-origin-resource-policy': 'cross-origin',
        },
        body: Buffer.from(reply.raw.base64, 'base64'),
      });
    if (status >= 400) {
      problems.expectsErrors = true;
      return route.fulfill({ status, headers: CORS, json: errorBody(reply.code ?? 'INTERNAL') });
    }
    try {
      mock.schema?.parse(reply.body);
    } catch (e) {
      problems.list.push(
        `fixture breaks its schema: ${method} ${path}: ${(e instanceof Error ? e.message : String(e)).slice(0, 400)}`,
      );
      return route.fulfill({ status: 500, headers: CORS, json: errorBody('FIXTURE_INVALID') });
    }
    return route.fulfill({ status, headers: CORS, json: reply.body ?? {} });
  });
  return problems;
}
