'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { UstaadIcon } from '../shell/icons';

/**
 * A bottom sheet on phones and a centred dialog above 760 px: a native modal `<dialog>` (focus stays inside, Escape
 * and a tap on the dim area close it, focus goes back to the opener through `onClose`). One sheet at a time: a sheet
 * that leads to another replaces its own content instead of stacking (design rule "no stacked modals").
 */
export function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const l = useTranslations('ustaad.labels');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
      className={`m-0 mt-auto max-h-[88dvh] w-full max-w-none overscroll-contain rounded-t-[26px] bg-surface p-0 text-ink shadow-dialog backdrop:bg-navy/55 tab:m-auto tab:rounded-[26px] ${wide ? 'tab:max-w-2xl' : 'tab:max-w-lg'}`}
    >
      <div className="flex max-h-[88dvh] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="font-heading text-lg font-extrabold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => {
              close.current();
            }}
            aria-label={l('close')}
            className="press inline-flex size-12 items-center justify-center rounded-full bg-pill text-ink hover:bg-line focus-visible:outline-3 focus-visible:outline-focus"
          >
            <UstaadIcon name="close" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </dialog>
  );
}
