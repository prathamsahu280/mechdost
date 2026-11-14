'use client';

import { lazy, Suspense } from 'react';
import { PUSH_CONFIGURED } from '@/lib/push/push-state';

const Prompt = lazy(() => import('./push-card').then((m) => ({ default: m.PushPrompt })));

/**
 * Where the "get updates on this device" card goes on a portal home (spec 10, design 2026-11-15: partners and staff see
 * it on their first portal visit). Renders nothing until the push key is set (Q103) and loads the card's code only
 * then; the Firebase library itself still waits for the tap on "Turn on".
 */
export function PushPromptSlot({ partner = true }: { partner?: boolean }) {
  if (!PUSH_CONFIGURED) return null;
  return (
    <Suspense fallback={null}>
      <Prompt partner={partner} />
    </Suspense>
  );
}
