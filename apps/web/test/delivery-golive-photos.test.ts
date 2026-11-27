/**
 * DC-P11 (QA 2026-11-27, P0): every rider job photo failed with 422 JOB_REQUIRED because the web sent only `file` +
 * `purpose`. Job photos (pickup, delivery, failure) must carry the job id; document photos do not.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiAgentClient } from '../src/lib/delivery/api-clients';

vi.mock('../src/lib/auth/firebase-client', () => ({ currentIdToken: () => Promise.resolve('token') }));

const JOB = '0190f0a0-0000-7000-8000-000000000001';

function captureFetch() {
  const forms: FormData[] = [];
  vi.stubGlobal('fetch', (_url: string, init: { body: FormData }) => {
    forms.push(init.body);
    return Promise.resolve(new Response(JSON.stringify({ mediaId: JOB }), { status: 201 }));
  });
  return forms;
}

describe('rider photo uploads carry the job id (DC-P11)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends jobId with a pickup photo', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const forms = captureFetch();
    const res = await apiAgentClient('en').uploadPhoto(
      new Blob(['x'], { type: 'image/webp' }),
      'pickup',
      JOB,
    );
    expect(res.ok).toBe(true);
    expect(forms[0]?.get('jobId')).toBe(JOB);
    expect(forms[0]?.get('purpose')).toBe('pickup');
  });

  it('sends no jobId with a document photo', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    const forms = captureFetch();
    await apiAgentClient('en').uploadPhoto(new Blob(['x'], { type: 'image/webp' }), 'document');
    expect(forms[0]?.has('jobId')).toBe(false);
  });

  it('the job screen passes its job id to every photo capture', () => {
    const src = readFileSync(new URL('../src/components/delivery/agent-job.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/upload=\{client\.uploadPhoto\}/);
    expect(src.match(/client\.uploadPhoto\([^)]*job\.jobId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
