/**
 * Response shapes of the Ustaad Q&A, Learn, local and media routes that have no named DTO yet (the routes declare
 * them inline). The web client checks every answer with these (hard rule 4); keep them in step with
 * `apps/api/src/routes/ustaad/{qa,local,media}.ts`.
 */
import { z } from 'zod';
import { JobDto, MyLocationDto, ZoneDto } from './local';
import { QuestionCardDto } from './qa';

export const QuestionListResponse = z.object({
  items: z.array(QuestionCardDto),
  nextCursor: z.string().nullable(),
});
export const AskedResponse = z.object({ code: z.string(), status: z.string() });
export const AnsweredResponse = z.object({ id: z.uuid(), status: z.string() });
export const HelpfulResponse = z.object({ helpfulCount: z.number().int(), voted: z.boolean() });
export const SolvedResponse = z.object({ status: z.literal('solved') });
export const LearnProgressResponse = z.object({ watchedSeconds: z.number().int(), completed: z.boolean() });
export const MyLocationResponse = z.object({ location: MyLocationDto.nullable() });
export const OkResponse = z.object({ ok: z.literal(true) });
export const ZonesResponse = z.object({ zones: z.array(ZoneDto) });
export const JobsResponse = z.object({ items: z.array(JobDto), next: z.string().nullable() });
export const AppliedResponse = z.object({ applicationId: z.string(), status: z.string() });
export const MovedResponse = z.object({ status: z.string() });
export const DeclaredUploadResponse = z.object({
  mediaId: z.uuid(),
  put: z.object({ url: z.string(), headers: z.record(z.string(), z.string()) }).optional(),
  expiresAt: z.string(),
});
export const VerifiedMediaResponse = z.object({ id: z.uuid(), status: z.string() });
export const SignedUrlResponse = z.object({ url: z.string(), expiresAt: z.string() });
