'use client';

import { useEffect, useState } from 'react';

/**
 * True once it is known that nobody is signed in. A record page whose code in the URL is malformed never asks the API
 * (so it cannot learn "sign in" from an answer); a signed-out visitor still gets the sign-in prompt rather than "not
 * found" (QA pass 3, 2026-11-16). `enabled` is false while the page has a good code and asks the API itself.
 */
export function useSignedOut(enabled: boolean, locale: string): boolean {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void import('./auth/firebase-client')
      .then(({ currentIdToken }) => currentIdToken(locale))
      .catch(() => null)
      .then((token) => {
        if (live) setSignedOut(!token);
      });
    return () => {
      live = false;
    };
  }, [enabled, locale]);
  return signedOut;
}
