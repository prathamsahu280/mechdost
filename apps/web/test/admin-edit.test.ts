import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import { PERMISSIONS, ROLES } from '@mechdost/shared/rbac';
import {
  adminEditPath,
  canEditCatalogue,
  CATALOGUE_EDIT_PERMISSION,
  editableSlugFromSearch,
  isEditableSlug,
  meAllowsCatalogueEdit,
  shouldProbeSession,
} from '../src/lib/catalogue/admin-edit';

/** Storefront "Edit" shortcut for catalogue staff (user 2026-11-25; spec 08): who sees it and where it leads. */
describe('canEditCatalogue', () => {
  it('is the permission the editor routes require, and a real permission', () => {
    expect(CATALOGUE_EDIT_PERMISSION).toBe('products:write');
    expect(Object.keys(PERMISSIONS)).toContain(CATALOGUE_EDIT_PERMISSION);
  });

  it('holds for exactly the roles that hold products:write', () => {
    const holders = Object.entries(ROLES)
      .filter(([, role]) => (role.permissions as readonly string[]).includes(CATALOGUE_EDIT_PERMISSION))
      .map(([name]) => name)
      .sort();
    expect(holders).toEqual(['catalogue_manager', 'super_admin']);
  });

  it('is false for no permissions and for look-alike strings', () => {
    expect(canEditCatalogue([])).toBe(false);
    expect(canEditCatalogue(['products:publish', 'products:write:own', 'PRODUCTS:WRITE'])).toBe(false);
    expect(canEditCatalogue(['orders:read', 'products:write'])).toBe(true);
  });
});

describe('meAllowsCatalogueEdit', () => {
  it('reads only a well-formed permissions array from the live /me answer', () => {
    expect(meAllowsCatalogueEdit({ permissions: ['products:write'] })).toBe(true);
    expect(meAllowsCatalogueEdit({ permissions: ['orders:read'] })).toBe(false);
    expect(meAllowsCatalogueEdit({ canEditCatalogue: true })).toBe(false);
    expect(meAllowsCatalogueEdit({ permissions: 'products:write' })).toBe(false);
    expect(meAllowsCatalogueEdit({ permissions: [1] })).toBe(false);
    expect(meAllowsCatalogueEdit(null)).toBe(false);
  });
});

describe('shouldProbeSession', () => {
  it('asks the API only for a staff session, never for guests, customers, shops or workshops', () => {
    expect(shouldProbeSession(undefined)).toBe(false);
    expect(shouldProbeSession('customer')).toBe(false);
    expect(shouldProbeSession('shop')).toBe(false);
    expect(shouldProbeSession('workshop')).toBe(false);
    expect(shouldProbeSession('admin')).toBe(true);
  });
});

describe('deep link', () => {
  it('carries the slug only', () => {
    expect(adminEditPath('exide-xltz4a')).toBe('/admin/catalogue?product=exide-xltz4a');
  });

  it('accepts catalogue slugs and refuses anything that could change the API path', () => {
    expect(isEditableSlug('castrol-activ-4t-20w40-900ml')).toBe(true);
    for (const bad of ['', '../admin', 'a/b', 'a?b=1', 'A B', 'x%2e%2e', '-lead', 'a'.repeat(200)])
      expect(isEditableSlug(bad)).toBe(false);
  });

  it('reads the slug back from the address and ignores a bad one', () => {
    expect(editableSlugFromSearch('?product=exide-xltz4a')).toBe('exide-xltz4a');
    expect(editableSlugFromSearch('?product=../orders')).toBeNull();
    expect(editableSlugFromSearch('')).toBeNull();
    expect(editableSlugFromSearch('?x=1')).toBeNull();
  });
});

describe('copy and analytics', () => {
  it('has the button label and tip in English and Hindi, with the product name in the label', () => {
    for (const lang of [en, hi]) {
      expect(lang.catalogue.adminEdit).toContain('{name}');
      expect(lang.catalogue.adminEditTip.length).toBeGreaterThan(3);
    }
    expect(hi.catalogue.adminEdit).not.toBe(en.catalogue.adminEdit);
  });

  it('registers admin_storefront_edit_clicked with slug and origin only', () => {
    const schema = CLIENT_EVENT_SCHEMAS.admin_storefront_edit_clicked;
    expect(schema.safeParse({ slug: 'a-b', from: 'card' }).success).toBe(true);
    expect(schema.safeParse({ slug: 'a-b', from: 'x' }).success).toBe(false);
    expect(schema.safeParse({ slug: 'a-b', from: 'page', token: 't' }).success).toBe(false);
  });
});
