/**
 * Ustaad Q&A and Learn routes (spec 23 § 8 "Q&A" and "Learn"; plan tasks C1–C2). Behind `ustaadGate` (index.ts) and
 * `requireUstaadMember` here, so a non-member gets the generic 404 before validation. Rate limits per member
 * (SR-43): 10 questions, 30 answers, 100 votes a day; Learn progress 120 an hour; reads share the member-read rule.
 * The repositories enforce the rest (answer gate by track, no self-vote, one best answer by the asker, caps) and
 * never return a phone number (SR-34).
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  answerUstaadQuestion,
  askUstaadQuestion,
  chooseUstaadBestAnswer,
  listUstaadQuestions,
  setUstaadAnswerParts,
  ustaadLearnView,
  ustaadQuestionDetail,
  voteUstaadAnswerHelpful,
  writeUstaadLearnProgress,
} from '@mechdost/db/repo';
import {
  AnswerDto,
  AnswerPartsDto,
  AskQuestionDto,
  BestAnswerDto,
  LearnProgressDto,
  LearnViewDto,
  QuestionCardDto,
  QuestionDetailDto,
  QuestionListQueryDto,
  USTAAD_QUESTION_CODE_RE,
} from '@mechdost/shared/ustaad/dto/qa';
import { ApiError } from '../../errors';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const Code = z.object({ code: z.string().regex(USTAAD_QUESTION_CODE_RE) });
const Id = z.object({ id: z.uuid() });
const sec = [{ bearerAuth: [] }];

const list = createRoute({
  method: 'get',
  path: '/ustaad/questions',
  tags: ['ustaad'],
  summary: 'Q&A list (all | for_you | mine | unanswered), newest first, keyset cursor',
  security: sec,
  request: { query: QuestionListQueryDto },
  responses: {
    200: json(
      z
        .object({ items: z.array(QuestionCardDto), nextCursor: z.string().nullable() })
        .openapi('UstaadQuestionList'),
      'Questions',
    ),
    ...errorResponses,
  },
});
const ask = createRoute({
  method: 'post',
  path: '/ustaad/questions',
  tags: ['ustaad'],
  summary: 'Ask a question by voice note and/or text (idempotent on idemKey)',
  security: sec,
  request: { body: body(AskQuestionDto) },
  responses: {
    201: json(z.object({ code: z.string(), status: z.string() }), 'Asked'),
    ...conflict,
    ...errorResponses,
  },
});
const detail = createRoute({
  method: 'get',
  path: '/ustaad/questions/{code}',
  tags: ['ustaad'],
  summary: 'A question thread with its answers, the best answer and parts used',
  security: sec,
  request: { params: Code },
  responses: { 200: json(QuestionDetailDto, 'Thread'), ...errorResponses },
});
const answer = createRoute({
  method: 'post',
  path: '/ustaad/questions/{code}/answers',
  tags: ['ustaad'],
  summary: 'Answer by voice note and/or text (Ustaads; Chhotu only when the setting allows)',
  security: sec,
  request: { params: Code, body: body(AnswerDto) },
  responses: {
    201: json(z.object({ id: z.uuid(), status: z.string() }), 'Answered'),
    ...conflict,
    ...errorResponses,
  },
});
const best = createRoute({
  method: 'post',
  path: '/ustaad/questions/{code}/best',
  tags: ['ustaad'],
  summary: 'The asker marks one best answer (409 when one is already chosen)',
  security: sec,
  request: { params: Code, body: body(BestAnswerDto) },
  responses: {
    200: json(z.object({ status: z.literal('solved') }), 'Solved'),
    ...conflict,
    ...errorResponses,
  },
});
const helpful = createRoute({
  method: 'post',
  path: '/ustaad/answers/{id}/helpful',
  tags: ['ustaad'],
  summary: 'Mark an answer helpful (one per member; never your own)',
  security: sec,
  request: { params: Id },
  responses: {
    200: json(z.object({ helpfulCount: z.number().int(), voted: z.boolean() }), 'Voted'),
    ...errorResponses,
  },
});
const parts = createRoute({
  method: 'put',
  path: '/ustaad/answers/{id}/parts',
  tags: ['ustaad'],
  summary: '"Parts used in this fix": up to 5 MechDost products under the best answer (its author)',
  security: sec,
  request: { params: Id, body: body(AnswerPartsDto) },
  responses: { 200: json(z.object({ count: z.number().int() }), 'Saved'), ...errorResponses },
});
const learn = createRoute({
  method: 'get',
  path: '/ustaad/learn',
  tags: ['ustaad'],
  summary: 'Learn (Seekho): active courses and resources with my progress',
  security: sec,
  responses: { 200: json(LearnViewDto, 'Learn'), ...errorResponses },
});
const progress = createRoute({
  method: 'put',
  path: '/ustaad/learn/{id}/progress',
  tags: ['ustaad'],
  summary:
    'Progress on a resource: watched seconds (hosted video) or a self mark (external link, capped a day)',
  security: sec,
  request: { params: Id, body: body(LearnProgressDto) },
  responses: {
    200: json(z.object({ watchedSeconds: z.number().int(), completed: z.boolean() }), 'Saved'),
    ...errorResponses,
  },
});

export function ustaadQaRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const limit = (rule: (typeof USTAAD_RATE_RULES)[keyof typeof USTAAD_RATE_RULES]) =>
    rateLimit(deps.rateLimiter, rule, userKey);
  for (const path of [
    '/ustaad/questions',
    '/ustaad/questions/*',
    '/ustaad/answers/*',
    '/ustaad/learn',
    '/ustaad/learn/*',
  ])
    app.use(path, requireUstaadMember(deps));
  app.on(
    'GET',
    ['/ustaad/questions', '/ustaad/questions/*', '/ustaad/learn'],
    limit(USTAAD_RATE_RULES.memberReads),
  );
  app.on('POST', '/ustaad/questions', limit(USTAAD_RATE_RULES.questions));
  app.on('POST', '/ustaad/questions/:code/answers', limit(USTAAD_RATE_RULES.answers));
  app.on('POST', '/ustaad/questions/:code/best', limit(USTAAD_RATE_RULES.votes));
  app.on('POST', '/ustaad/answers/:id/helpful', limit(USTAAD_RATE_RULES.votes));
  app.on('PUT', '/ustaad/answers/:id/parts', limit(USTAAD_RATE_RULES.answers));
  app.on('PUT', '/ustaad/learn/:id/progress', limit(USTAAD_RATE_RULES.learn));

  const actor = (c: Context<AppEnv>) => {
    const member = c.get('ustaadMember');
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return { userId: c.get('auth').user.id, memberId: member.id };
  };

  return app
    .openapi(list, async (c) =>
      c.json(await listUstaadQuestions(deps.db, actor(c), c.req.valid('query')), 200),
    )
    .openapi(ask, async (c) => {
      const q = await askUstaadQuestion(deps.db, actor(c), c.req.valid('json'));
      return c.json({ code: q.code, status: q.status }, 201);
    })
    .openapi(detail, async (c) =>
      c.json(await ustaadQuestionDetail(deps.db, actor(c), c.req.valid('param').code), 200),
    )
    .openapi(answer, async (c) => {
      const a = await answerUstaadQuestion(deps.db, actor(c), c.req.valid('param').code, c.req.valid('json'));
      return c.json(a, 201);
    })
    .openapi(best, async (c) =>
      c.json(
        await chooseUstaadBestAnswer(
          deps.db,
          actor(c),
          c.req.valid('param').code,
          c.req.valid('json').answerId,
        ),
        200,
      ),
    )
    .openapi(helpful, async (c) =>
      c.json(await voteUstaadAnswerHelpful(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(parts, async (c) =>
      c.json(
        await setUstaadAnswerParts(
          deps.db,
          actor(c),
          c.req.valid('param').id,
          c.req.valid('json').productIds,
        ),
        200,
      ),
    )
    .openapi(learn, async (c) => c.json(await ustaadLearnView(deps.db, actor(c)), 200))
    .openapi(progress, async (c) =>
      c.json(
        await writeUstaadLearnProgress(deps.db, actor(c), c.req.valid('param').id, c.req.valid('json')),
        200,
      ),
    );
}
