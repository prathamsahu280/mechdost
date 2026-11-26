import { MemberViewDto, type Join, type MemberView } from '@mechdost/shared/ustaad/dto/members';
import { authed, type ApiResult } from '../orders-api';

/**
 * `POST /v1/ustaad/join` from the browser (spec 23 § 8 "Membership"). Signed in with a verified phone; the answer is
 * validated with the shared schema (hard rule 4). Loaded with `import()` so pages that never join do not carry it.
 */
export function submitUstaadJoin(locale: string, body: Join): Promise<ApiResult<MemberView>> {
  return authed(locale, '/ustaad/join', MemberViewDto, { method: 'POST', body });
}
