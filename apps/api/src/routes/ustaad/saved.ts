/**
 * Saved API (spec 23 § 5 Saved, § 10 API; design docs/superpowers/specs/2026-11-28-mechanic-network-saved-design.md).
 * Members only (`requireUstaadMember`: 404 for anyone else). Save any kind by path, the mixed Saved list with kind /
 * collection / words filters, the counts, and the member's own collections (another member's id is a 404). Posts keep
 * `…/posts/{id}/save`; `PUT /ustaad/saves/post/{id}` is the same save through the shared control.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  addToUstaadSaveCollection,
  createUstaadSaveCollection,
  deleteUstaadSaveCollection,
  listUstaadSavedItems,
  removeFromUstaadSaveCollection,
  renameUstaadSaveCollection,
  saveUstaadItem,
  unsaveUstaadItem,
  ustaadSavedSummary,
} from '@mechdost/db/repo';
import {
  CreateCollectionDto,
  RenameCollectionDto,
  SaveCollectionDto,
  SavedPageDto,
  SavedQueryDto,
  SavedSummaryDto,
  SaveKindDto,
  SaveStateDto,
} from '@mechdost/shared/ustaad/dto/saved';
import { ApiError } from '../../errors';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, json } from '../service-schemas';

const sec = [{ bearerAuth: [] }];
const Target = z.object({ kind: SaveKindDto, id: z.uuid() });
const CollectionId = z.object({ id: z.uuid() });
const CollectionTarget = z.object({ id: z.uuid(), kind: SaveKindDto, itemId: z.uuid() });

const list = createRoute({
  method: 'get',
  path: '/ustaad/saves',
  tags: ['ustaad'],
  summary: 'My saved items of every kind, newest save first (kind, collection and words filters)',
  security: sec,
  request: { query: SavedQueryDto },
  responses: { 200: json(SavedPageDto, 'Saved items'), ...errorResponses },
});
const summary = createRoute({
  method: 'get',
  path: '/ustaad/saves/summary',
  tags: ['ustaad'],
  summary: 'Counts per kind and my collections',
  security: sec,
  responses: { 200: json(SavedSummaryDto, 'Summary'), ...errorResponses },
});
const save = createRoute({
  method: 'put',
  path: '/ustaad/saves/{kind}/{id}',
  tags: ['ustaad'],
  summary: 'Save a post, question, answer, job or lesson (idempotent)',
  security: sec,
  request: { params: Target },
  responses: { 200: json(SaveStateDto, 'Saved'), ...errorResponses },
});
const unsave = createRoute({
  method: 'delete',
  path: '/ustaad/saves/{kind}/{id}',
  tags: ['ustaad'],
  summary: 'Unsave (also takes it out of my collections)',
  security: sec,
  request: { params: Target },
  responses: { 200: json(SaveStateDto, 'Unsaved'), ...errorResponses },
});
const create = createRoute({
  method: 'post',
  path: '/ustaad/save-collections',
  tags: ['ustaad'],
  summary: 'Create a collection (at most 20; names unique ignoring case)',
  security: sec,
  request: { body: body(CreateCollectionDto) },
  responses: { 201: json(SaveCollectionDto, 'Created'), ...errorResponses },
});
const rename = createRoute({
  method: 'patch',
  path: '/ustaad/save-collections/{id}',
  tags: ['ustaad'],
  summary: 'Rename a collection (compare-and-set on version)',
  security: sec,
  request: { params: CollectionId, body: body(RenameCollectionDto) },
  responses: { 200: json(SaveCollectionDto, 'Renamed'), ...errorResponses },
});
const remove = createRoute({
  method: 'delete',
  path: '/ustaad/save-collections/{id}',
  tags: ['ustaad'],
  summary: 'Delete a collection (the saves stay)',
  security: sec,
  request: { params: CollectionId },
  responses: { 204: { description: 'Deleted' }, ...errorResponses },
});
const addItem = createRoute({
  method: 'put',
  path: '/ustaad/save-collections/{id}/items/{kind}/{itemId}',
  tags: ['ustaad'],
  summary: 'Put a saved item in a collection',
  security: sec,
  request: { params: CollectionTarget },
  responses: { 204: { description: 'Added' }, ...errorResponses },
});
const removeItem = createRoute({
  method: 'delete',
  path: '/ustaad/save-collections/{id}/items/{kind}/{itemId}',
  tags: ['ustaad'],
  summary: 'Take an item out of a collection',
  security: sec,
  request: { params: CollectionTarget },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});

export function ustaadSavedRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  for (const path of [
    '/ustaad/saves',
    '/ustaad/saves/*',
    '/ustaad/save-collections',
    '/ustaad/save-collections/*',
  ])
    app.use(path, requireUstaadMember(deps));
  app.on(
    'GET',
    ['/ustaad/saves', '/ustaad/saves/*'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey),
  );
  app.on(['PUT', 'DELETE'], '/ustaad/saves/*', rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.saves, userKey));
  app.on(
    ['POST', 'PATCH', 'DELETE'],
    ['/ustaad/save-collections', '/ustaad/save-collections/:id'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.membershipWrites, userKey),
  );
  app.on(
    ['PUT', 'DELETE'],
    '/ustaad/save-collections/:id/items/*',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.saves, userKey),
  );

  const actor = (c: Context<AppEnv>) => {
    const member = c.get('ustaadMember');
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return { userId: c.get('auth').user.id, memberId: member.id };
  };

  return app
    .openapi(list, async (c) =>
      c.json(await listUstaadSavedItems(deps.db, actor(c), c.req.valid('query')), 200),
    )
    .openapi(summary, async (c) => c.json(await ustaadSavedSummary(deps.db, actor(c)), 200))
    .openapi(save, async (c) => c.json(await saveUstaadItem(deps.db, actor(c), c.req.valid('param')), 200))
    .openapi(unsave, async (c) =>
      c.json(await unsaveUstaadItem(deps.db, actor(c), c.req.valid('param')), 200),
    )
    .openapi(create, async (c) =>
      c.json(await createUstaadSaveCollection(deps.db, actor(c), c.req.valid('json').name), 201),
    )
    .openapi(rename, async (c) =>
      c.json(
        await renameUstaadSaveCollection(deps.db, actor(c), c.req.valid('param').id, c.req.valid('json')),
        200,
      ),
    )
    .openapi(remove, async (c) => {
      await deleteUstaadSaveCollection(deps.db, actor(c), c.req.valid('param').id);
      return c.body(null, 204);
    })
    .openapi(addItem, async (c) => {
      const p = c.req.valid('param');
      await addToUstaadSaveCollection(deps.db, actor(c), p.id, { kind: p.kind, id: p.itemId });
      return c.body(null, 204);
    })
    .openapi(removeItem, async (c) => {
      const p = c.req.valid('param');
      await removeFromUstaadSaveCollection(deps.db, actor(c), p.id, { kind: p.kind, id: p.itemId });
      return c.body(null, 204);
    });
}
