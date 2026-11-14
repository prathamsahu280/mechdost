import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sign-out must stop this browser receiving the previous person's pushes even when the API call fails (security review
// 2026-11-15): the browser's own push subscription is unsubscribed, whatever the server answered.
const removePushDevice = vi.fn<(locale: string, id: string) => Promise<void>>();
vi.mock('../src/lib/notices-api', () => ({ removePushDevice }));
let saved: string | null = 'dev-1';
vi.mock('../src/lib/push/push-state', () => ({
  savedPushDeviceId: () => saved,
  savePushDeviceId: (id: string | null) => {
    saved = id;
  },
}));

const unsubscribe = vi.fn(() => Promise.resolve(true));

beforeEach(() => {
  saved = 'dev-1';
  removePushDevice.mockReset();
  unsubscribe.mockClear();
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({ unsubscribe }) } }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('forgetPushDevice', () => {
  it('unsubscribes the browser even when the API removal fails', async () => {
    removePushDevice.mockRejectedValueOnce(new Error('network'));
    const { forgetPushDevice } = await import('../src/lib/push/forget-device');
    await forgetPushDevice('en');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(saved).toBeNull();
  });

  it('unsubscribes after a successful removal too', async () => {
    removePushDevice.mockResolvedValueOnce(undefined);
    const { forgetPushDevice } = await import('../src/lib/push/forget-device');
    await forgetPushDevice('en');
    expect(removePushDevice).toHaveBeenCalledWith('en', 'dev-1');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
