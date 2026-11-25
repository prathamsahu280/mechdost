'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

/** How long the toast waits for "Undo". Hovering or focusing it pauses the clock (WCAG 2.2.1); Escape closes it. */
export const UNDO_MS = 20_000;

/**
 * The one calm message after removing notifications: what happened, an Undo button and a close button. A polite live
 * region, so a screen reader hears it without focus moving. No modal, no stacking: it replaces itself. It sits above the
 * bottom tab bar on phones. No motion, so there is nothing to reduce.
 */
export function UndoToast({
  message,
  undoLabel,
  closeLabel,
  onUndo,
  onClose,
  onDismiss,
  error = false,
}: {
  message: string;
  undoLabel: string | null;
  closeLabel: string;
  onUndo: () => void;
  /** The time ran out. */
  onClose: () => void;
  /** The person pressed Close or Escape (focus may need a new home); defaults to `onClose`. */
  onDismiss?: () => void;
  error?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus;
  useEffect(() => {
    // An error stays until it is closed: a failure must not vanish before a screen-reader user has read it.
    if (paused || error) return undefined;
    const timer = setTimeout(onClose, UNDO_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [paused, error, message, onClose]);

  return (
    <div
      onPointerEnter={() => {
        setHover(true);
      }}
      onPointerLeave={() => {
        setHover(false);
      }}
      onFocus={() => {
        setFocus(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          (onDismiss ?? onClose)();
        }
      }}
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-center gap-1 rounded-2xl bg-ink py-1 pr-1 pl-4 text-surface shadow-float lg:bottom-6"
    >
      <p className="min-w-0 flex-1 py-2 text-sm font-bold break-words">{message}</p>
      {undoLabel ? (
        <button
          type="button"
          onClick={onUndo}
          className="press inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-extrabold underline underline-offset-4 hover:bg-surface/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface"
        >
          {undoLabel}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onDismiss ?? onClose}
        className="press inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
