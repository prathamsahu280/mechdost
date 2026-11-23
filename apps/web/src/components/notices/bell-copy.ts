/**
 * Every string the bell and its dropdown show, resolved on the server (the header is a Server Component) and passed
 * down as props, so no i18n runtime ships to the browser (spec 16). `{count}` is replaced client-side.
 */
export interface BellCopy {
  label: string;
  labelUnread: string;
  liveOne: string;
  liveOther: string;
  more: string;
  seeAll: string;
  markAllRead: string;
  loading: string;
  loadError: string;
  retry: string;
  unread: string;
  done: string;
  emptyTitle: string;
  emptyBody: string;
  emptyActionShop: string;
  emptyActionPortal: string;
  close: string;
}
