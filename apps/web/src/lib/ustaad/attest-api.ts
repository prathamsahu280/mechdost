import {
  AttestOutcomeDto,
  AttestPageDto,
  type AttestOutcome,
  type AttestPage,
  type AttestSubmit,
} from '@mechdost/shared/ustaad/dto/verification';
import { call, type ApiResult } from '../orders-api';

/**
 * The garage owner's page (spec 23 § 4 flow 2, SR-6): public calls, no sign-in. Both go from the owner's browser (the
 * API limits them per IP; a server-side fetch would share one IP for every owner). Answers are checked with the shared
 * schemas (hard rule 4). Opening the page never uses the link up; only the submit does.
 */
const path = (token: string) => `/ustaad-attest/${encodeURIComponent(token)}`;

export const fetchAttestPage = (token: string): Promise<ApiResult<AttestPage>> =>
  call(path(token), AttestPageDto);

export const submitAttest = (token: string, body: AttestSubmit): Promise<ApiResult<AttestOutcome>> =>
  call(path(token), AttestOutcomeDto, { method: 'POST', body });
