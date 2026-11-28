import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentStep } from '@/lib/delivery/view';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('rider job step rail (P3, design § 7)', () => {
  it('uses the shared StepRail with the four steps, not the old thin bar', () => {
    const job = src('components/delivery/agent-job.tsx');
    expect(job).toMatch(/<StepRail/);
    expect(job).not.toMatch(/function StepBar/);
    for (const n of ['step_shop', 'step_pickup', 'step_customer', 'step_deliver']) expect(job).toContain(n);
    expect(job).toMatch(/current=\{step - 1\}/);
  });
  it('the step comes from the real job state: accepted → picked up, on arrival the next step', () => {
    expect(agentStep('accepted', false)).toBe(1);
    expect(agentStep('accepted', true)).toBe(2);
    expect(agentStep('picked_up', false)).toBe(3);
    expect(agentStep('picked_up', true)).toBe(4);
    expect(agentStep('delivered', false)).toBeNull();
  });
});
