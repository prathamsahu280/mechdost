import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Founder 2026-11-27: the rider's "Take new jobs" card was barely visible — the card was bg-surface on the navy hero
// (same colour in dark) and the switch's off track was `bg-line` (~1.2:1 on the card; WCAG 1.4.11 needs 3:1).
const portal = readFileSync(new URL('../src/components/delivery/agent-portal.tsx', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../src/components/ui/switch.tsx', import.meta.url), 'utf8');

describe('rider online card is clearly visible', () => {
  it('switch off-track uses a ≥3:1 token, not the hairline colour', () => {
    expect(sw).not.toMatch(/rounded-pill bg-line /);
    expect(sw).toMatch(/bg-input-border/);
  });
  it('the card has a state colour and an outline that separates it from the hero', () => {
    const card = portal.slice(portal.indexOf('data-online-card'), portal.indexOf('agent-online-state'));
    expect(card).toMatch(/bg-success-bg/);
    expect(card).toMatch(/ring-2/);
    expect(card).toMatch(/text-lg/);
  });
});
