'use client';

import { undoCountText } from '@/lib/notices-view';
import type { Feed } from './use-notice-feed';
import { UndoToast } from './undo-toast';

export interface FeedToastCopy {
  removedToast: string;
  /** "Cleared {count} read notifications". */
  clearedToast: string;
  undo: string;
  undoFailed: string;
  removeFailed: string;
  dismissToast: string;
}

/**
 * The toast for what the feed just did: "Notification removed", "Cleared 4 read notifications" or the error. The two
 * live regions are always in the page and only their text changes, so screen readers announce it (a region created
 * together with its text is often missed); the visible toast with its buttons sits outside them.
 */

/** Where focus goes when the toast's own button removes it: the list heading, so the person keeps their place. */
const toHeading = () => {
  document.querySelector<HTMLElement>('[data-notice-heading]')?.focus();
};

export function FeedToast({ feed, copy }: { feed: Feed; copy: FeedToastCopy }) {
  const error = feed.actionError ? (feed.actionError === 'undo' ? copy.undoFailed : copy.removeFailed) : null;
  const done = feed.undo
    ? feed.undo.kind === 'one'
      ? copy.removedToast
      : undoCountText(copy.clearedToast, feed.undo.count)
    : null;
  return (
    <>
      <span role="status" className="sr-only">
        {error ? '' : (done ?? '')}
      </span>
      <span role="alert" className="sr-only">
        {error ?? ''}
      </span>
      {error ? (
        <UndoToast
          error
          message={error}
          undoLabel={null}
          closeLabel={copy.dismissToast}
          onUndo={feed.closeUndo}
          onClose={feed.closeUndo}
          onDismiss={() => {
            feed.closeUndo();
            toHeading();
          }}
        />
      ) : done ? (
        <UndoToast
          message={done}
          undoLabel={copy.undo}
          closeLabel={copy.dismissToast}
          onUndo={() => {
            feed.undoLast();
            toHeading();
          }}
          onClose={feed.closeUndo}
          onDismiss={() => {
            feed.closeUndo();
            toHeading();
          }}
        />
      ) : null}
    </>
  );
}
