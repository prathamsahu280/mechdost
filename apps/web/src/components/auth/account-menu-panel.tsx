'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Briefcase,
  Car,
  Globe,
  Heart,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Undo2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { homeFor, type DemoRole } from '@/demo/session-state';
import { switchLocalePath, type SiteLocale } from '@/lib/locale-path';
import { ACCOUNT_SECTIONS } from '@/lib/sections';
import { toggleTheme, useTheme } from '@/lib/theme-client';
import type { AccountMenuCopy } from './account-menu';

/**
 * The account menu behind the header avatar (v4, decision 2026-11-23). Loaded on the first open (lazy chunk, spec 16).
 * WAI-ARIA menu button pattern: focus moves to the first item on open; ↑ ↓ Home End move (wrapping), a letter jumps to
 * the next item starting with it, Escape closes and gives focus back to the avatar, Tab or a tap outside closes. The
 * dark-mode row is a `menuitemcheckbox`; Sign out is the last row, in the error colour.
 */
const SAVED_AVAILABLE = ACCOUNT_SECTIONS.includes('wishlist');
const ROW =
  'press group flex min-h-11 w-full items-center gap-[11px] rounded-[10px] px-2.5 text-left text-sm font-medium hover:bg-pill focus-visible:bg-pill';

function Row({
  icon: Icon,
  children,
  hint,
  danger = false,
}: {
  icon: LucideIcon;
  children: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
}) {
  return (
    <>
      <Icon aria-hidden="true" className={`size-[18px] shrink-0 ${danger ? 'text-error' : 'text-muted'}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint}
    </>
  );
}

export default function AccountMenuPanel({
  name,
  phone,
  role,
  initial,
  prefix,
  copy,
  onClose,
  onSignOut,
}: {
  name: string;
  phone: string;
  role: DemoRole;
  initial: string | null;
  prefix: string;
  copy: AccountMenuCopy;
  /** `refocus`: give focus back to the avatar (Escape, a choice), not when the person moved on by Tab or a tap. */
  onClose: (refocus: boolean) => void;
  onSignOut: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const theme = useTheme();
  const locale: SiteLocale = pathname === '/hi' || pathname.startsWith('/hi/') ? 'hi' : 'en';
  const target: SiteLocale = locale === 'hi' ? 'en' : 'hi';
  const languageHref = switchLocalePath(pathname, target);
  const isCustomer = role === 'customer';

  const items = (): HTMLElement[] =>
    menu.current ? [...menu.current.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];

  // Warm the sign-out code while the menu is open, so a tap on Sign out acts at once (bug 2026-11-23).
  useEffect(() => {
    void import('@/lib/auth/sign-out');
  }, []);
  useEffect(() => {
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) onClose(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => {
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(at + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(at < 0 ? -1 : at - 1);
        return;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        return;
      case 'End':
        e.preventDefault();
        focusAt(-1);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        return;
      case 'Tab':
        onClose(false);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const letter = e.key.toLowerCase();
          const ordered = [...list.slice(at + 1), ...list.slice(0, at + 1)];
          ordered.find((el) => el.textContent.trim().toLowerCase().startsWith(letter))?.focus();
        }
    }
  }

  return (
    <div
      ref={root}
      className="absolute z-[45] min-w-[260px] rounded-2xl bg-surface p-2 shadow-float max-sm:inset-x-0 max-sm:top-full max-sm:mt-2.5 sm:top-full sm:right-0 sm:mt-2.5 sm:w-[270px]"
    >
      <div className="mb-1.5 flex items-center gap-3 border-b border-line px-2.5 pt-2.5 pb-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-navy-sidebar-active to-navy font-heading text-sm font-extrabold text-white"
        >
          {initial ?? <UserRound className="size-5" />}
        </span>
        <div className="min-w-0" data-user-content>
          <b className="block truncate font-heading text-[15px] font-extrabold text-ink">{name}</b>
          <small className="block truncate text-[12.5px] text-muted">{phone ? `+91 ${phone}` : ''}</small>
        </div>
      </div>
      <div ref={menu} role="menu" aria-label={copy.account} onKeyDown={onKeyDown}>
        {isCustomer ? (
          <>
            <MenuLink
              href={`${prefix}/account/profile`}
              track="menu_profile"
              icon={UserRound}
              onClose={onClose}
            >
              {copy.profile}
            </MenuLink>
            <MenuLink href={`${prefix}/account/orders`} track="menu_orders" icon={Package} onClose={onClose}>
              {copy.orders}
            </MenuLink>
            <MenuLink href={`${prefix}/account/refunds`} track="menu_refunds" icon={Undo2} onClose={onClose}>
              {copy.refunds}
            </MenuLink>
            <MenuLink href={`${prefix}/account/vehicles`} track="menu_vehicles" icon={Car} onClose={onClose}>
              {copy.vehicles}
            </MenuLink>
            {/* Saved products exist with real sign-in only; in the demo the page is a 404 and its prefetch loops. */}
            {SAVED_AVAILABLE ? (
              <MenuLink href={`${prefix}/account/wishlist`} track="menu_saved" icon={Heart} onClose={onClose}>
                {copy.saved}
              </MenuLink>
            ) : null}
          </>
        ) : (
          <MenuLink
            href={`${prefix}${homeFor(role)}`}
            track="menu_portal"
            icon={role === 'admin' ? LayoutDashboard : Briefcase}
            onClose={onClose}
          >
            {copy.portal}
          </MenuLink>
        )}
        <div role="separator" className="mx-1 my-1.5 h-px bg-line" />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={theme === null ? undefined : theme === 'dark'}
          tabIndex={-1}
          data-track="menu_dark_mode"
          onClick={toggleTheme}
          className={`${ROW} text-ink`}
        >
          <Row
            icon={Moon}
            hint={
              <span
                aria-hidden="true"
                className="relative ml-auto h-5 w-9 shrink-0 rounded-full bg-input-border transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform group-aria-checked:bg-accent-button group-aria-checked:after:translate-x-4"
              />
            }
          >
            {copy.dark}
          </Row>
        </button>
        <a
          role="menuitem"
          tabIndex={-1}
          href={languageHref}
          lang={target}
          hrefLang={target}
          data-track={`language_${target}`}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            // A full page load on purpose (see language-switcher.tsx): the locale cookie only updates on a document request.
            e.preventDefault();
            window.location.assign(languageHref + window.location.search + window.location.hash);
          }}
          className={`${ROW} text-ink`}
        >
          <Row icon={Globe}>{copy.language}</Row>
        </a>
        <div role="separator" className="mx-1 my-1.5 h-px bg-line" />
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-track="header_sign_out"
          onClick={() => {
            // Hide the page at once (bug 2026-11-23); the sign-out then loads the home page fresh.
            document.documentElement.setAttribute('data-signing-out', '');
            onSignOut();
            void import('@/lib/auth/sign-out').then((m) => m.signOutEverywhere());
          }}
          className={`${ROW} text-error`}
        >
          <Row icon={LogOut} danger>
            {copy.signOut}
          </Row>
        </button>
      </div>
    </div>
  );
}

function MenuLink({
  href,
  track,
  icon,
  onClose,
  children,
}: {
  href: string;
  track: string;
  icon: LucideIcon;
  onClose: (refocus: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      tabIndex={-1}
      data-track={track}
      onClick={() => {
        onClose(false);
      }}
      className={`${ROW} text-ink`}
    >
      <Row icon={icon}>{children}</Row>
    </Link>
  );
}
