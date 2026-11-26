import { describe, expect, it } from 'vitest';
import {
  AGENT_STATUSES,
  AGENT_VEHICLE_TYPES,
  DEFAULT_VEHICLE_MAX_LOAD_KG,
  DELIVERY_FAIL_REASONS,
  agentMayReceiveOffers,
  contactStage,
  documentNumberProblem,
  maskDocumentNumber,
  normaliseDocumentNumber,
  retryAllowed,
  returnRefundKind,
  subOrderLoad,
  subOrderDeliveryMode,
  vehicleCarries,
} from '../src/delivery/codes';
import {
  AgentJobDetail,
  AgentJobCard,
  CustomerDeliveryBlock,
  DeliveryAgentApplication,
  AgentDocumentInput,
  PickupInput,
  DeliverInput,
  FailInput,
  FailureDecisionInput,
} from '../src/delivery/api';
import {
  DELIVERY_JOB_STATES,
  deliveryJobMachine,
  deliveryOfferMachine,
  agentStatusMachine,
  orderMachine,
  ORDER_STATES,
} from '../src/state';
import { OPERATIONAL_SETTINGS } from '../src/settings';
import { ROLES } from '../src/rbac';

describe('delivery job machine (design 2026-11-26, Lead calls 1, 4, 13)', () => {
  it('follows the happy path: needs an agent → offered → accepted → picked up → delivered', () => {
    const path = ['needs_agent', 'offered', 'accepted', 'picked_up', 'delivered'] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(deliveryJobMachine.can(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('lets only the agent accept, pick up, deliver and fail', () => {
    expect(deliveryJobMachine.canActor('offered', 'accepted', 'delivery_agent')).toBe(true);
    expect(deliveryJobMachine.canActor('offered', 'accepted', 'admin')).toBe(false);
    expect(deliveryJobMachine.canActor('accepted', 'picked_up', 'delivery_agent')).toBe(true);
    expect(deliveryJobMachine.canActor('accepted', 'picked_up', 'shop')).toBe(false);
    expect(deliveryJobMachine.canActor('picked_up', 'delivered', 'delivery_agent')).toBe(true);
    expect(deliveryJobMachine.canActor('picked_up', 'delivered', 'shop')).toBe(false);
    expect(deliveryJobMachine.canActor('picked_up', 'failed', 'delivery_agent')).toBe(true);
    expect(deliveryJobMachine.canActor('picked_up', 'failed', 'admin')).toBe(false);
  });

  it('keeps admin overrides for pickup and delivery (audited, codes locked)', () => {
    expect(deliveryJobMachine.canActor('accepted', 'picked_up', 'admin')).toBe(true);
    expect(deliveryJobMachine.canActor('picked_up', 'delivered', 'admin')).toBe(true);
  });

  it('puts a declined, expired or withdrawn offer and a give-up back in the admin queue', () => {
    expect(deliveryJobMachine.canActor('offered', 'needs_agent', 'delivery_agent')).toBe(true);
    expect(deliveryJobMachine.canActor('offered', 'needs_agent', 'system')).toBe(true);
    expect(deliveryJobMachine.canActor('offered', 'needs_agent', 'admin')).toBe(true);
    expect(deliveryJobMachine.canActor('accepted', 'needs_agent', 'delivery_agent')).toBe(true);
    expect(deliveryJobMachine.canActor('accepted', 'needs_agent', 'admin')).toBe(true);
  });

  it('has both retry paths: same agent keeps the parcel, or it goes back to the shop', () => {
    // Same agent: admin sends the failed job out again (the parcel never left the agent).
    expect(deliveryJobMachine.canActor('failed', 'picked_up', 'admin')).toBe(true);
    expect(deliveryJobMachine.canActor('failed', 'picked_up', 'delivery_agent')).toBe(false);
    // Another agent or close: the agent carries it back; the shop confirms with the return code.
    expect(deliveryJobMachine.canActor('failed', 'returning', 'admin')).toBe(true);
    expect(deliveryJobMachine.canActor('returning', 'returned', 'shop')).toBe(true);
    expect(deliveryJobMachine.canActor('returning', 'returned', 'admin')).toBe(true);
    expect(deliveryJobMachine.canActor('returning', 'returned', 'delivery_agent')).toBe(false);
  });

  it('cancels only before pickup, and has three terminal states', () => {
    for (const from of ['needs_agent', 'offered', 'accepted'] as const)
      expect(deliveryJobMachine.canActor(from, 'cancelled', 'admin')).toBe(true);
    expect(deliveryJobMachine.can('picked_up', 'cancelled')).toBe(false);
    expect([...deliveryJobMachine.terminal].sort()).toEqual(['cancelled', 'delivered', 'returned']);
    for (const s of DELIVERY_JOB_STATES)
      if (deliveryJobMachine.isTerminal(s)) expect(deliveryJobMachine.next(s)).toEqual([]);
  });
});

describe('delivery offer machine', () => {
  it('mirrors order assignments: accept, decline, expire, withdraw; an accepted offer can be given up or taken back', () => {
    expect(deliveryOfferMachine.canActor('offered', 'accepted', 'delivery_agent')).toBe(true);
    expect(deliveryOfferMachine.canActor('offered', 'declined', 'delivery_agent')).toBe(true);
    expect(deliveryOfferMachine.canActor('offered', 'expired', 'system')).toBe(true);
    expect(deliveryOfferMachine.canActor('offered', 'expired', 'delivery_agent')).toBe(false);
    expect(deliveryOfferMachine.canActor('offered', 'withdrawn', 'admin')).toBe(true);
    expect(deliveryOfferMachine.canActor('accepted', 'given_up', 'delivery_agent')).toBe(true);
    expect(deliveryOfferMachine.canActor('accepted', 'withdrawn', 'admin')).toBe(true);
    expect(deliveryOfferMachine.isTerminal('declined')).toBe(true);
  });
});

describe('agent status machine', () => {
  it('activates after verification, pauses and resumes, suspends and offboards', () => {
    expect(AGENT_STATUSES).toEqual(['onboarding', 'active', 'paused', 'suspended', 'offboarded']);
    expect(agentStatusMachine.canActor('onboarding', 'active', 'admin')).toBe(true);
    expect(agentStatusMachine.canActor('onboarding', 'active', 'delivery_agent')).toBe(false);
    expect(agentStatusMachine.canActor('active', 'paused', 'admin')).toBe(true);
    expect(agentStatusMachine.canActor('paused', 'active', 'admin')).toBe(true);
    expect(agentStatusMachine.canActor('paused', 'active', 'system')).toBe(true);
    expect(agentStatusMachine.canActor('active', 'suspended', 'admin')).toBe(true);
    expect(agentStatusMachine.canActor('suspended', 'offboarded', 'admin')).toBe(true);
    expect(agentStatusMachine.isTerminal('offboarded')).toBe(true);
  });
  it('offers go only to active, online agents', () => {
    expect(agentMayReceiveOffers({ status: 'active', online: true })).toBe(true);
    expect(agentMayReceiveOffers({ status: 'active', online: false })).toBe(false);
    expect(agentMayReceiveOffers({ status: 'onboarding', online: true })).toBe(false);
    expect(agentMayReceiveOffers({ status: 'paused', online: true })).toBe(false);
  });
});

describe('order machine with delivery agents', () => {
  it('adds ready_for_pickup and returned', () => {
    expect(ORDER_STATES).toContain('ready_for_pickup');
    expect(ORDER_STATES).toContain('returned');
    expect(orderMachine.isTerminal('returned')).toBe(true);
  });
  it('the shop marks a packed agent-mode order ready; only the agent (or the audited override) picks it up', () => {
    expect(orderMachine.canActor('packed', 'ready_for_pickup', 'shop')).toBe(true);
    expect(orderMachine.canActor('ready_for_pickup', 'out_for_delivery', 'delivery_agent')).toBe(true);
    expect(orderMachine.canActor('ready_for_pickup', 'out_for_delivery', 'admin')).toBe(true);
    expect(orderMachine.canActor('ready_for_pickup', 'out_for_delivery', 'shop')).toBe(false);
  });
  it('the agent delivers; the shop confirms a hand-back (retry → ready again, close → returned)', () => {
    expect(orderMachine.canActor('out_for_delivery', 'delivered', 'delivery_agent')).toBe(true);
    expect(orderMachine.canActor('out_for_delivery', 'returned', 'shop')).toBe(true);
    expect(orderMachine.canActor('out_for_delivery', 'returned', 'admin')).toBe(true);
    expect(orderMachine.canActor('out_for_delivery', 'returned', 'customer')).toBe(false);
    expect(orderMachine.canActor('out_for_delivery', 'ready_for_pickup', 'shop')).toBe(true);
  });
  it('a switch to shop delivery puts a ready order back to packed; staff may still cancel before pickup', () => {
    expect(orderMachine.canActor('ready_for_pickup', 'packed', 'shop')).toBe(true);
    expect(orderMachine.canActor('ready_for_pickup', 'cancelled', 'admin')).toBe(true);
    expect(orderMachine.canActor('ready_for_pickup', 'cancelled', 'customer')).toBe(false);
    expect(orderMachine.can('returned', 'delivered')).toBe(false);
  });
  it('keeps the self-delivery path unchanged', () => {
    expect(orderMachine.canActor('packed', 'shipped', 'shop')).toBe(true);
    expect(orderMachine.canActor('shipped', 'out_for_delivery', 'shop')).toBe(true);
    expect(orderMachine.canActor('out_for_delivery', 'delivered', 'shop')).toBe(true);
  });
});

describe('who delivers a sub-order (Lead calls 8, 9, 11)', () => {
  it('COD always stays with the shop; prepaid follows the shop mode only in an enabled city', () => {
    expect(subOrderDeliveryMode({ shopMode: 'agents', paymentMethod: 'cod', agentsEnabled: true })).toBe(
      'shop',
    );
    expect(subOrderDeliveryMode({ shopMode: 'agents', paymentMethod: 'online', agentsEnabled: true })).toBe(
      'agent',
    );
    expect(subOrderDeliveryMode({ shopMode: 'agents', paymentMethod: 'online', agentsEnabled: false })).toBe(
      'shop',
    );
    expect(subOrderDeliveryMode({ shopMode: 'self', paymentMethod: 'online', agentsEnabled: true })).toBe(
      'shop',
    );
  });
});

describe('load and vehicles (Lead calls 5, 12)', () => {
  it('has the founder-default maximum loads', () => {
    expect(AGENT_VEHICLE_TYPES).toEqual(['bike', 'scooter', 'three_wheeler', 'goods_vehicle']);
    expect(DEFAULT_VEHICLE_MAX_LOAD_KG).toEqual({
      bike: 20,
      scooter: 20,
      three_wheeler: 300,
      goods_vehicle: 1000,
    });
  });
  it('sums quantity × variant weight and falls back to the product load class when a weight is missing', () => {
    expect(
      subOrderLoad([
        { quantity: 2, weightG: 4_000, loadClass: 'light' },
        { quantity: 1, weightG: 1_500, loadClass: 'light' },
      ]),
    ).toEqual({ knownWeightG: 9_500, unknownClass: null });
    expect(
      subOrderLoad([
        { quantity: 1, weightG: null, loadClass: 'heavy' },
        { quantity: 3, weightG: 1_000, loadClass: 'light' },
        { quantity: 1, weightG: null, loadClass: 'light' },
      ]),
    ).toEqual({ knownWeightG: 3_000, unknownClass: 'heavy' });
  });
  it('a bike carries up to its max load and light items only', () => {
    const max = DEFAULT_VEHICLE_MAX_LOAD_KG;
    expect(vehicleCarries('bike', { knownWeightG: 20_000, unknownClass: null }, max)).toBe(true);
    expect(vehicleCarries('bike', { knownWeightG: 20_001, unknownClass: null }, max)).toBe(false);
    expect(vehicleCarries('bike', { knownWeightG: 1_000, unknownClass: 'heavy' }, max)).toBe(false);
    expect(vehicleCarries('three_wheeler', { knownWeightG: 1_000, unknownClass: 'heavy' }, max)).toBe(true);
    expect(vehicleCarries('three_wheeler', { knownWeightG: 0, unknownClass: 'bulky' }, max)).toBe(false);
    expect(vehicleCarries('goods_vehicle', { knownWeightG: 0, unknownClass: 'bulky' }, max)).toBe(true);
    // The admin lowers a limit per city.
    expect(vehicleCarries('bike', { knownWeightG: 15_000, unknownClass: null }, { ...max, bike: 10 })).toBe(
      false,
    );
  });
});

describe('failed delivery: retry and refund (Lead calls 4, 13)', () => {
  it('allows one free retry by default (two attempts)', () => {
    expect(retryAllowed({ failedAttempts: 1, maxAttempts: 2 })).toBe(true);
    expect(retryAllowed({ failedAttempts: 2, maxAttempts: 2 })).toBe(false);
  });
  it('refunds in full when it was not the customer’s fault', () => {
    for (const reason of ['wrong_address', 'unsafe_location', 'vehicle_issue', 'other'] as const)
      expect(returnRefundKind([reason])).toBe('full');
    // Unreachable once and returned without a retry: not held against the customer.
    expect(returnRefundKind(['customer_unreachable'])).toBe('full');
  });
  it('keeps the delivery fee when the customer refused, or stayed unreachable after the retry', () => {
    expect(returnRefundKind(['customer_refused'])).toBe('parts_only');
    expect(returnRefundKind(['vehicle_issue', 'customer_refused'])).toBe('parts_only');
    expect(returnRefundKind(['customer_unreachable', 'customer_unreachable'])).toBe('parts_only');
    expect(returnRefundKind(['customer_unreachable', 'vehicle_issue'])).toBe('full');
  });
  it('has ML-ready failure codes', () => {
    expect(DELIVERY_FAIL_REASONS).toEqual([
      'customer_unreachable',
      'customer_refused',
      'wrong_address',
      'unsafe_location',
      'vehicle_issue',
      'other',
    ]);
  });
});

describe('contact reveal by stage (Lead call 6)', () => {
  it('shows the shop and only the area before pickup, the customer after pickup, nothing once closed', () => {
    expect(contactStage('offered')).toBe('pickup');
    expect(contactStage('accepted')).toBe('pickup');
    expect(contactStage('picked_up')).toBe('drop');
    // Awaiting the admin's decision: the agent may be sent to try again, so the customer stays visible.
    expect(contactStage('failed')).toBe('drop');
    // Carrying the parcel back: the shop only.
    expect(contactStage('returning')).toBe('return');
    for (const s of ['delivered', 'returned', 'cancelled', 'needs_agent'] as const)
      expect(contactStage(s)).toBe('none');
  });
});

describe('documents (founder: PAN, licence, RC; never Aadhaar)', () => {
  it('normalises and checks each kind', () => {
    expect(normaliseDocumentNumber('pan', ' abcde1234f ')).toBe('ABCDE1234F');
    expect(documentNumberProblem('pan', 'ABCDE1234F')).toBeNull();
    expect(documentNumberProblem('pan', 'ABCDE12345')).toBe('format');
    expect(documentNumberProblem('driving_licence', 'CG04 20190012345')).toBeNull();
    expect(documentNumberProblem('vehicle_rc', 'CG-04-AB-1234')).toBeNull();
    expect(documentNumberProblem('vehicle_rc', '22BH1234AA')).toBeNull();
  });
  it('refuses a 12-digit number in any document field (Aadhaar)', () => {
    for (const kind of ['pan', 'driving_licence', 'vehicle_rc'] as const) {
      expect(documentNumberProblem(kind, '1234 5678 9012')).toBe('aadhaar');
      expect(
        AgentDocumentInput.safeParse({ kind, number: '123456789012', mediaId: crypto.randomUUID() }).success,
      ).toBe(false);
    }
  });
  it('masks numbers to the last four characters', () => {
    expect(maskDocumentNumber('ABCDE1234F')).toBe('••••••234F');
  });
});

describe('DTO privacy', () => {
  it('agent job DTOs never carry the customer delivery code or the shop pickup code', () => {
    for (const shape of [AgentJobCard.shape, AgentJobDetail.shape]) {
      const keys = Object.keys(shape);
      expect(keys).not.toContain('deliveryCode');
      expect(keys).not.toContain('pickupCode');
    }
  });
  it('the customer delivery block names neither the shop nor the agent phone', () => {
    const keys = Object.keys(CustomerDeliveryBlock.shape);
    expect(keys).toEqual(expect.arrayContaining(['agentFirstName', 'vehicleType', 'stage']));
    for (const k of keys) expect(k.toLowerCase()).not.toMatch(/shop|phone/);
  });
  it('code inputs are strict four digits and need a photo', () => {
    const photo = crypto.randomUUID();
    expect(PickupInput.safeParse({ pickupCode: '1234', photoMediaId: photo, version: 1 }).success).toBe(true);
    expect(PickupInput.safeParse({ pickupCode: '12345', photoMediaId: photo, version: 1 }).success).toBe(
      false,
    );
    expect(
      DeliverInput.safeParse({ deliveryCode: '1234', photoMediaId: photo, version: 1, extra: 1 }).success,
    ).toBe(false);
    expect(FailInput.safeParse({ reasonCode: 'other', photoMediaId: photo, version: 1 }).success).toBe(false);
    expect(
      FailInput.safeParse({ reasonCode: 'other', note: 'Gate locked', photoMediaId: photo, version: 1 })
        .success,
    ).toBe(true);
    expect(FailureDecisionInput.safeParse({ decision: 'retry', agent: 'same', version: 2 }).success).toBe(
      true,
    );
  });
  it('the public application takes name, phone, city and vehicle only', () => {
    expect(
      DeliveryAgentApplication.safeParse({
        name: 'Ravi Kumar',
        phone: '9876543210',
        cityCode: 'RPR',
        vehicleType: 'bike',
        consent: true,
      }).success,
    ).toBe(true);
    expect(
      DeliveryAgentApplication.safeParse({
        name: 'Ravi Kumar',
        phone: '9876543210',
        cityCode: 'RPR',
        vehicleType: 'bike',
        consent: true,
        aadhaar: '123456789012',
      }).success,
    ).toBe(false);
  });
});

describe('role and settings', () => {
  it('the delivery_agent role holds deliveries:* only, never orders:*', () => {
    const role = ROLES.delivery_agent;
    expect(role.staff).toBe(false);
    expect(role.scope).toBe('self');
    for (const p of role.permissions)
      expect(p.startsWith('deliveries:') || p.startsWith('account:') || p === 'tickets:create').toBe(true);
    expect(role.permissions).toContain('deliveries:fulfil');
  });
  it('staff get manage and assign; ops and city managers both', () => {
    for (const r of ['ops_manager', 'city_manager'] as const) {
      expect(ROLES[r].permissions).toContain('delivery_agents:manage');
      expect(ROLES[r].permissions).toContain('delivery_jobs:assign');
    }
    expect(ROLES.support_agent.permissions as readonly string[]).not.toContain('delivery_jobs:assign');
  });
  it('switches agents off by default in every city and keeps the design defaults', () => {
    expect(OPERATIONAL_SETTINGS['delivery.agents_enabled'].default).toBe(false);
    expect(OPERATIONAL_SETTINGS['delivery.offer_timeout_min'].default).toBe(5);
    expect(OPERATIONAL_SETTINGS['delivery.photos_required'].default).toBe(true);
    expect(OPERATIONAL_SETTINGS['delivery.max_attempts'].default).toBe(2);
    expect(OPERATIONAL_SETTINGS['delivery.invite_hours'].default).toBe(72);
    expect(OPERATIONAL_SETTINGS['delivery.max_load_bike_kg'].default).toBe(20);
  });
});
