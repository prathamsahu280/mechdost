'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { SOUND_STORAGE_KEY, freshIds, soundOnFromStorage } from '@/lib/partner-kit';

type AudioCtor = typeof AudioContext;

function readPref(): boolean {
  try {
    return soundOnFromStorage(window.localStorage.getItem(SOUND_STORAGE_KEY));
  } catch {
    return true;
  }
}

function writePref(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

/** A short two-tone beep (Web Audio, no audio file). */
function beep(ctx: AudioContext) {
  const start = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const at = start + i * 0.18;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.17);
  }
}

export interface NewWorkAlert {
  /** The partner's choice (decision Q-PP-F3: on by default). */
  on: boolean;
  /** The browser still needs one tap before it may play sound: show "Turn on order sound". */
  needsTap: boolean;
  /** The tap: unlocks audio and keeps sound on. */
  unlock: () => void;
  setOn: (on: boolean) => void;
}

/**
 * New-work alert (design 2026-11-27 § 4; spec 07 § UI "sound + badge on new assignment"): a beep and a 200 ms
 * vibration when the list gains an id while the page is visible. Never on the first load, never in a hidden tab,
 * never the only signal (the list, the bell badge and the caller's live region say it too). Sound is on by default
 * (Q-PP-F3); any tap on the page unlocks audio, and the "Turn on order sound" button shows only while it is locked.
 *
 * `ids` is the current list of open work ids, or null while loading.
 */
export function useNewWorkAlert(portal: PartnerPortal, ids: readonly string[] | null): NewWorkAlert {
  const [on, setOnState] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const audio = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;
    if (!Ctor) return null;
    ctxRef.current = new Ctor();
    return ctxRef.current;
  }, []);

  useEffect(() => {
    const pref = readPref();
    setOnState(pref);
    if (!pref) return;
    const ctx = audio();
    if (!ctx) return;
    setNeedsTap(ctx.state !== 'running');
    // Any tap on the page unlocks audio (on by default), so most partners never see the button.
    const unlockOnTap = () => {
      void ctx.resume().then(() => {
        setNeedsTap(ctx.state !== 'running');
      });
    };
    document.addEventListener('pointerdown', unlockOnTap, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlockOnTap);
    };
  }, [audio]);

  useEffect(() => {
    if (!ids) return;
    const fresh = freshIds(seen.current, ids);
    seen.current = new Set(ids);
    if (fresh.length === 0 || document.visibilityState !== 'visible') return;
    if (on) {
      const ctx = audio();
      if (ctx?.state === 'running') beep(ctx);
    }
    if (typeof navigator.vibrate === 'function') navigator.vibrate(200);
    track('partner_offer_alert_played', { portal, count: Math.min(fresh.length, 50) });
  }, [ids, on, audio, portal]);

  const setOn = useCallback(
    (next: boolean) => {
      writePref(next);
      setOnState(next);
      track('partner_sound_enabled', { portal, on: next });
      if (next) {
        const ctx = audio();
        void ctx?.resume().then(() => {
          setNeedsTap(ctx.state !== 'running');
        });
      }
    },
    [audio, portal],
  );

  const unlock = useCallback(() => {
    const ctx = audio();
    if (!ctx) return;
    void ctx.resume().then(() => {
      setNeedsTap(ctx.state !== 'running');
      if (ctx.state === 'running') beep(ctx);
    });
    writePref(true);
    setOnState(true);
    track('partner_sound_enabled', { portal, on: true });
  }, [audio, portal]);

  return { on, needsTap: on && needsTap, unlock, setOn };
}
