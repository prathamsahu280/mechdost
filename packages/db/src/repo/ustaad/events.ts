/**
 * The network's append-only timeline and analytics in one call (spec 23 § 6.1, § 16; hard rules 9 and 16). Every
 * state change writes an `ustaad_events` row in the caller's transaction. The analytics event goes to the event store
 * too, except for a member in restricted mode (SR-42: a minor report turns their analytics off).
 */
import { eq } from 'drizzle-orm';
import type { ServerEvent, ServerEventProps } from '@mechdost/shared/analytics';
import type { USTAAD_EVENT_ENTITIES } from '@mechdost/shared/ustaad/codes';
import { ustaadEvents, ustaadMembers } from '../../schema';
import { recordServerEvent } from '../events';
import type { Tx } from '../orders';

export interface UstaadEventInput {
  entityType: (typeof USTAAD_EVENT_ENTITIES)[number];
  entityId: string;
  kind: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  reasonCode?: string | null;
  actorId: string | null;
  actorRole: string;
  cityId?: string | null;
  props?: Record<string, unknown>;
}

export async function recordUstaadEvent<E extends ServerEvent>(
  tx: Tx,
  input: UstaadEventInput,
  analytics?: {
    name: E;
    /** The member the analytics event is about (restricted mode check); null = staff or system. */
    memberId: string | null;
    userId: string | null;
    props: ServerEventProps[E];
  },
): Promise<void> {
  await tx.insert(ustaadEvents).values({
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    reasonCode: input.reasonCode ?? null,
    actorId: input.actorId,
    actorRole: input.actorRole,
    cityId: input.cityId ?? null,
    props: { schema_version: 1, ...input.props },
  });
  if (!analytics) return;
  if (analytics.memberId && (await isRestricted(tx, analytics.memberId))) return;
  await recordServerEvent(tx, analytics.name, {
    userId: analytics.userId,
    cityId: input.cityId ?? null,
    props: analytics.props,
  });
}

async function isRestricted(tx: Tx, memberId: string): Promise<boolean> {
  const [row] = await tx
    .select({ mode: ustaadMembers.restrictedMode })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, memberId))
    .limit(1);
  return row !== undefined && row.mode !== 'none';
}
