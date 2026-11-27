/**
 * Line icons for the Ustaad shell (24 px grid, 1.8 stroke, currentColor). Decorative: every use sits next to a text
 * label, so they are `aria-hidden`. Server-renderable; no icon library in the bundle.
 */
import type { ReactNode } from 'react';

export type UstaadIconName =
  | 'home'
  | 'discover'
  | 'create'
  | 'learn'
  | 'me'
  | 'mic'
  | 'jobs'
  | 'dukaan'
  | 'network'
  | 'area'
  | 'saved'
  | 'pin'
  | 'card'
  | 'bell'
  | 'plus'
  | 'heart'
  | 'comment'
  | 'whatsapp'
  | 'more'
  | 'play'
  | 'pause'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'check'
  | 'send'
  | 'photo'
  | 'flag'
  | 'lock'
  | 'message'
  | 'video'
  | 'doc'
  | 'link'
  | 'poll'
  | 'hash'
  | 'copy'
  | 'users'
  | 'ask'
  | 'before'
  | 'after'
  | 'fixlog'
  | 'tip'
  | 'camera'
  | 'gallery'
  | 'speed'
  | 'stopSquare'
  | 'cancel'
  | 'helpful'
  | 'bestStamp'
  | 'shield'
  | 'progress'
  | 'prev'
  | 'next'
  | 'tag';

const PATHS: Record<UstaadIconName, ReactNode> = {
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
  ),
  comment: (
    <path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
  ),
  whatsapp: (
    <>
      <path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6z" />
      <path d="M9.2 8.8c.3 2.6 2.4 4.9 5.2 5.6l1.1-1.2-1.6-.9-.8.7c-1-.4-1.9-1.3-2.3-2.3l.7-.8-.9-1.6z" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronLeft: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  send: <path d="M4.5 12 19.5 4.5 15 19.5l-3.5-6z" />,
  photo: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <circle cx="9" cy="10.5" r="1.8" />
      <path d="m20.5 16-5-5-8 7.5" />
    </>
  ),
  flag: <path d="M5.5 20.5v-16h11l-1.5 4 1.5 4h-11" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  message: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 3.5z" />,
  video: (
    <>
      <rect x="3.5" y="6.5" width="12" height="11" rx="2" />
      <path d="m15.5 10.5 5-3v9l-5-3z" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l4 4v13H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M14 3.5v4h4M9 12.5h6M9 16h6" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  poll: <path d="M5 19.5v-6M10 19.5v-11M15 19.5v-8M20 19.5V5" />,
  hash: <path d="M9 4.5 7.5 19.5M16.5 4.5 15 19.5M4.5 9h15M4 15h15" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.6.6 2.6 2 3 4.2" />
    </>
  ),
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  discover: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  create: <path d="M12 5v14M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  learn: (
    <>
      <path d="M3 9.5 12 5l9 4.5-9 4.5z" />
      <path d="M7 11.5V16c1.5 1.3 3.2 2 5 2s3.5-.7 5-2v-4.5" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  jobs: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17" />
    </>
  ),
  dukaan: (
    <>
      <path d="M4 9.5 5.5 5h13L20 9.5" />
      <path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5" />
      <path d="M5.5 12v7.5h13V12M10 19.5v-4h4v4" />
    </>
  ),
  network: (
    <>
      <circle cx="8" cy="9" r="3" />
      <circle cx="16.5" cy="10" r="2.5" />
      <path d="M2.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14 15.2c2.6-.6 5.6.6 6.5 3.8" />
    </>
  ),
  area: (
    <>
      <path d="m9 4.5-5.5 2v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>
  ),
  saved: <path d="M7 4.5h10a1 1 0 0 1 1 1v14l-6-3.8-6 3.8v-14a1 1 0 0 1 1-1z" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.5 15.5c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h4.5M14 13h3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  // U1 (2026-11-27 UI upgrade § 8.0): shared names for U1–U4; drawn on the same 24 px grid.
  ask: (
    <>
      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 3.5z" />
      <path d="M10 9.3a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6 1v.3M12 14.2v.1" />
    </>
  ),
  before: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M12 5v14M7 10.5l1.5 1.5L7 13.5" />
    </>
  ),
  after: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M12 5v14M15 12.5l1.5 1.5 2.5-3" />
    </>
  ),
  fixlog: <path d="M6 4.5h12v15H6zM9 9h6M9 12.5h6M9 16h4" />,
  tip: (
    <>
      <path d="M9 17.5h6M10 20.5h4" />
      <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.5.4.7 1 .7 1.6v.4h5v-.4c0-.6.2-1.2.7-1.6A5.5 5.5 0 0 0 12 3.5z" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.3" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="5.5" width="13" height="13" rx="1.5" />
      <path d="M19.5 8.5v11a1 1 0 0 1-1 1h-11M3.5 15.5l3.5-3.5 3 3 2-2 4.5 4.5" />
    </>
  ),
  speed: (
    <>
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="m12 14 3.5-4" />
    </>
  ),
  stopSquare: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  cancel: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  helpful: (
    <>
      <path d="M7.5 10.5v9h-3v-9zM7.5 10.5 11 4.5c1.2 0 2 .9 2 2v3h5a1.5 1.5 0 0 1 1.5 1.8l-1.3 6.5a1.5 1.5 0 0 1-1.5 1.2H7.5" />
    </>
  ),
  bestStamp: (
    <>
      <circle cx="12" cy="10" r="5.5" />
      <path d="m9.5 10 1.8 1.8 3.2-3.3M8.5 14.5l-1.5 6 5-2.5 5 2.5-1.5-6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  progress: <path d="M4.5 12h15M4.5 12h8" />,
  prev: <path d="M6 5.5v13M18 5.5 9 12l9 6.5z" />,
  next: <path d="M18 5.5v13M6 5.5l9 6.5-9 6.5z" />,
  tag: (
    <>
      <path d="M4 4.5h7.5l8.5 8.5-7 7-8.5-8.5z" />
      <circle cx="8.5" cy="9" r="1.3" />
    </>
  ),
};

export function UstaadIcon({
  name,
  size = 24,
  filled = false,
}: {
  name: UstaadIconName;
  size?: number;
  /** Solid shape (a liked heart, a saved bookmark); the state is also in `aria-pressed`. */
  filled?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
