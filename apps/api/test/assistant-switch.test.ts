import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

const base = { DATABASE_POOL_URL: 'postgres://x' };
const KEY = 'sk-ant-test-0000000000000000000000';

describe('customer assistant switch (founder 2026-11-26: off for now, the key is for Ustaad smart correction)', () => {
  it('the key alone does not switch the assistant on', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: KEY }).assistant).toBeNull();
  });

  it('ASSISTANT_ENABLED=true with a key switches it on', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: KEY, ASSISTANT_ENABLED: 'true' }).assistant?.apiKey).toBe(
      KEY,
    );
  });

  it('enabled without a key stays off', () => {
    expect(loadConfig({ ...base, ASSISTANT_ENABLED: 'true' }).assistant).toBeNull();
  });

  it('smart correction still uses the key while the assistant is off', () => {
    const cfg = loadConfig({ ...base, ANTHROPIC_API_KEY: KEY, SMART_CORRECTION_PROVIDER: 'anthropic' });
    expect(cfg.assistant).toBeNull();
    expect(cfg.smartCorrection).not.toBeNull();
  });
});
