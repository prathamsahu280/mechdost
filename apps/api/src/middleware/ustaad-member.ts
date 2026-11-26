/**
 * Ustaad Network gates (spec 23 § 3; founder 2026-11-26 "staff preview"). Two layers, in this order:
 *
 * 1. `ustaadGate` — who may reach the network at all, from the setting `ustaad.access` (`off | staff_preview | open`).
 *    Anyone refused gets exactly the response of a path that does not exist (the app's generic 404), whether they are
 *    signed out, signed in as a customer or carry a broken token, so nobody can tell the network is there. Only when
 *    the network is `open` does a signed-out caller get the usual 401. Staff = a staff grant in a staff (two-step)
 *    session (`isStaffGrant`). During `staff_preview` a preview tester (admin-edited list, founder 2026-11-27) is let
 *    through too: this gate only; a tester is not staff anywhere else.
 * 2. `requireUstaadMember` — member routes: an active member row (404 otherwise; `USTAAD_BANNED` 403). The row and
 *    the `mechanic` grant are written in one transaction, so the guard reads the row (fresh) and never trusts a cached
 *    session: a member who just left is out at once, a member who just joined is in at once.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  readUstaadAccess,
  readUstaadPreviewTesterIds,
  readUstaadSettingValues,
  ustaadMemberOfUser,
} from '@mechdost/db/repo';
import { isStaffGrant } from '@mechdost/shared/auth';
import { ustaadAccessDecision } from '@mechdost/shared/ustaad/access';
import type { UstaadAccessMode } from '@mechdost/shared/ustaad/codes';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, handleNotFound } from '../errors';
import type { AppDeps, AppEnv } from '../types';
import { authenticate, BEARER } from './auth';

/** What the gate needs: the mode and, during the staff preview, the preview testers' user ids. */
export interface UstaadAccessSnapshot {
  mode: UstaadAccessMode;
  testers: ReadonlySet<string>;
}

/**
 * Per-instance cache of the access mode and the preview testers list (10 s); an admin save on this instance clears it
 * at once, other instances follow within the TTL (rule 7). One load reads both, so a refused caller costs no extra
 * query.
 */
export class UstaadAccessCache {
  private value: (UstaadAccessSnapshot & { until: number }) | null = null;
  constructor(
    private readonly load: () => Promise<UstaadAccessSnapshot>,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}
  async snapshot(): Promise<UstaadAccessSnapshot> {
    if (this.value && this.value.until > this.now()) return this.value;
    const snap = await this.load();
    this.value = { ...snap, until: this.now() + this.ttlMs };
    return snap;
  }
  async get(): Promise<UstaadAccessMode> {
    return (await this.snapshot()).mode;
  }
  clear(): void {
    this.value = null;
  }
}

export function ustaadAccessCache(deps: Pick<AppDeps, 'db'>): UstaadAccessCache {
  return new UstaadAccessCache(async () => {
    const mode = await readUstaadAccess(deps.db);
    // The list matters only during the staff preview (off hides everyone, open lets everyone in).
    const testers = mode === 'staff_preview' ? await readUstaadPreviewTesterIds(deps.db) : [];
    return { mode, testers: new Set(testers) };
  });
}

/** True when the signed-in caller holds a staff grant in a staff session (the grants exclude withheld ones). */
export const isUstaadStaff = (c: Context<AppEnv>): boolean => c.get('auth').grants.some(isStaffGrant);

export function ustaadGate(
  deps: Pick<AppDeps, 'db' | 'verifier'>,
  sessions: SessionCache,
  access: UstaadAccessCache,
): MiddlewareHandler<AppEnv> {
  const auth = authenticate(deps, sessions);
  return createMiddleware<AppEnv>(async (c, next) => {
    const { mode, testers } = await access.snapshot();
    if (mode === 'off') return handleNotFound(c);
    const hasToken = BEARER.test(c.req.header('authorization') ?? '');
    if (!hasToken) {
      if (ustaadAccessDecision(mode, { signedIn: false, staff: false, tester: false }) === 'sign_in')
        throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue');
      return handleNotFound(c);
    }
    let authenticated = false as boolean;
    try {
      await auth(c, () => {
        authenticated = true;
        return Promise.resolve();
      });
    } catch (err) {
      // A bad token, a blocked or deactivated account: an outsider still learns nothing while the network is closed.
      if (mode === 'open') throw err;
      return handleNotFound(c);
    }
    if (!authenticated) return handleNotFound(c);
    const viewer = {
      signedIn: true,
      staff: isUstaadStaff(c),
      // A tester is let through this gate only: never staff, so no staff preview, no `general.enabled` bypass.
      tester: testers.has(c.get('auth').user.id),
    };
    if (ustaadAccessDecision(mode, viewer) !== 'allow') return handleNotFound(c);
    await next();
  });
}

/** Member routes: an active member (or restricted: the repositories decide what restricted members may do). */
export function requireUstaadMember(deps: Pick<AppDeps, 'db'>): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const member = await ustaadMemberOfUser(deps.db, c.get('auth').user.id);
    if (!member || member.status === 'left') return handleNotFound(c);
    if (member.status === 'banned')
      throw new ApiError(403, 'USTAAD_BANNED', 'This account cannot use the network');
    // `general.enabled` off hides the network from members; staff keep their preview.
    const s = await readUstaadSettingValues(deps.db, ['ustaad.general.enabled']);
    if (!s['ustaad.general.enabled'] && !isUstaadStaff(c)) return handleNotFound(c);
    c.set('ustaadMember', member);
    await next();
  });
}
