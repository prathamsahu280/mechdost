import { describe, expect, it } from 'vitest';
import {
  ustaadApplicationMachine,
  ustaadAttestationMachine,
  ustaadConnectionMachine,
  ustaadContentMachine,
  ustaadJobMachine,
  ustaadLevelMachine,
  ustaadMediaMachine,
  ustaadMentorshipMachine,
  ustaadQuestionMachine,
  ustaadReportMachine,
  ustaadThreadMachine,
  ustaadVerificationMachine,
  ustaadVouchMachine,
} from '../src/state';

/** Spec 23 § 7: every legal move and the actor rules; a few illegal moves per machine. */
describe('Ustaad state machines (spec 23 § 7)', () => {
  it('verification: requested → in_review → approved|rejected; withdraw by member; revoke by staff', () => {
    const m = ustaadVerificationMachine;
    expect(m.canActor('requested', 'in_review', 'system')).toBe(true);
    expect(m.canActor('requested', 'in_review', 'admin')).toBe(true);
    expect(m.canActor('in_review', 'approved', 'admin')).toBe(true);
    expect(m.canActor('in_review', 'approved', 'member')).toBe(false);
    expect(m.canActor('in_review', 'approved', 'system')).toBe(false); // staff final approval locked (SR-8)
    expect(m.canActor('in_review', 'rejected', 'admin')).toBe(true);
    expect(m.canActor('requested', 'withdrawn', 'member')).toBe(true);
    expect(m.canActor('approved', 'revoked', 'admin')).toBe(true);
    expect(m.can('requested', 'approved')).toBe(false);
    expect(m.isTerminal('rejected')).toBe(true);
    expect(() => {
      m.assert('rejected', 'approved', 'admin');
    }).toThrow(/illegal/);
  });

  it('attestation and vouch', () => {
    const a = ustaadAttestationMachine;
    expect(a.canActor('requested', 'confirmed', 'workshop')).toBe(true);
    expect(a.canActor('requested', 'confirmed', 'member')).toBe(false);
    expect(a.canActor('requested', 'expired', 'system')).toBe(true);
    expect(a.canActor('confirmed', 'revoked', 'admin')).toBe(true);
    const v = ustaadVouchMachine;
    expect(v.canActor('requested', 'given', 'member')).toBe(true);
    expect(v.canActor('given', 'revoked', 'member')).toBe(true);
    expect(v.canActor('requested', 'expired', 'system')).toBe(true);
    expect(v.can('declined', 'given')).toBe(false);
  });

  it('levels go up only by the engine or staff, Bada and Master only by staff, down only by staff', () => {
    const l = ustaadLevelMachine;
    expect(l.canActor('apprentice', 'naya', 'admin')).toBe(true);
    expect(l.canActor('ustaad_pending', 'naya', 'admin')).toBe(true);
    expect(l.canActor('naya', 'pakka', 'system')).toBe(true);
    expect(l.canActor('pakka', 'bada', 'system')).toBe(false); // AT-LEVEL-2: staff row required
    expect(l.canActor('pakka', 'bada', 'admin')).toBe(true);
    expect(l.canActor('bada', 'master', 'system')).toBe(false);
    expect(l.canActor('pakka', 'naya', 'admin')).toBe(true);
    expect(l.canActor('pakka', 'naya', 'system')).toBe(false); // never drops for inactivity
    expect(l.can('apprentice', 'master')).toBe(false);
  });

  it('content: held → visible, author hides, staff removes and restores, stories expire', () => {
    const c = ustaadContentMachine;
    expect(c.canActor('held', 'visible', 'admin')).toBe(true);
    expect(c.canActor('held', 'visible', 'member')).toBe(false);
    expect(c.canActor('visible', 'hidden_author', 'member')).toBe(true);
    expect(c.canActor('visible', 'removed', 'admin')).toBe(true);
    expect(c.canActor('removed', 'visible', 'admin')).toBe(true);
    expect(c.canActor('visible', 'expired', 'system')).toBe(true);
    expect(c.canActor('visible', 'expired', 'member')).toBe(false);
  });

  it('question: open → answered → solved; closed; removed', () => {
    const q = ustaadQuestionMachine;
    expect(q.canActor('open', 'answered', 'system')).toBe(true);
    expect(q.canActor('answered', 'solved', 'member')).toBe(true);
    expect(q.canActor('open', 'closed', 'member')).toBe(true);
    expect(q.canActor('answered', 'closed', 'system')).toBe(true);
    expect(q.canActor('open', 'removed', 'admin')).toBe(true);
    expect(q.can('open', 'solved')).toBe(false);
  });

  it('report: open → in_review → actioned|dismissed; appeal decided by staff', () => {
    const r = ustaadReportMachine;
    expect(r.canActor('open', 'in_review', 'admin')).toBe(true);
    expect(r.canActor('in_review', 'actioned', 'admin')).toBe(true);
    expect(r.canActor('in_review', 'dismissed', 'admin')).toBe(true);
    expect(r.canActor('actioned', 'appealed', 'member')).toBe(true);
    expect(r.canActor('appealed', 'upheld', 'admin')).toBe(true);
    expect(r.canActor('appealed', 'overturned', 'member')).toBe(false);
  });

  it('job and application', () => {
    const j = ustaadJobMachine;
    expect(j.canActor('draft', 'pending_review', 'member')).toBe(true);
    expect(j.canActor('pending_review', 'open', 'system')).toBe(true);
    expect(j.canActor('open', 'paused', 'member')).toBe(true);
    expect(j.canActor('paused', 'open', 'member')).toBe(true);
    expect(j.canActor('open', 'expired', 'system')).toBe(true);
    expect(j.canActor('open', 'removed', 'admin')).toBe(true);
    const a = ustaadApplicationMachine;
    expect(a.canActor('applied', 'seen', 'member')).toBe(true);
    expect(a.canActor('shortlisted', 'hired', 'member')).toBe(true);
    expect(a.canActor('applied', 'closed', 'system')).toBe(true);
    expect(a.can('hired', 'rejected')).toBe(false);
  });

  it('media: pending_upload → uploaded → verified|rejected; removal archives; purge', () => {
    const m = ustaadMediaMachine;
    expect(m.canActor('pending_upload', 'uploaded', 'member')).toBe(true);
    expect(m.canActor('uploaded', 'verified', 'system')).toBe(true);
    expect(m.canActor('uploaded', 'rejected', 'system')).toBe(true);
    expect(m.canActor('verified', 'removed_archived', 'admin')).toBe(true);
    expect(m.canActor('removed_archived', 'purged', 'system')).toBe(true);
    expect(m.canActor('verified', 'purged', 'system')).toBe(true);
    expect(m.canActor('pending_upload', 'purged', 'system')).toBe(true);
    expect(m.can('rejected', 'verified')).toBe(false);
  });

  it('graph: connection, mentorship, thread', () => {
    expect(ustaadConnectionMachine.canActor('requested', 'accepted', 'member')).toBe(true);
    expect(ustaadConnectionMachine.canActor('accepted', 'removed', 'member')).toBe(true);
    expect(ustaadMentorshipMachine.canActor('requested', 'active', 'member')).toBe(true);
    expect(ustaadMentorshipMachine.canActor('active', 'ended', 'member')).toBe(true);
    expect(ustaadThreadMachine.canActor('requested', 'open', 'member')).toBe(true);
    expect(ustaadThreadMachine.canActor('open', 'blocked', 'member')).toBe(true);
  });
});
