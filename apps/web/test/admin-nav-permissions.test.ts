import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLES } from '@mechdost/shared/rbac';
import { ALL_ADMIN_SECTIONS } from '../src/lib/sections';
import { SECTION_PERMISSIONS, sectionsFor } from '../src/lib/admin-nav-permissions';

/**
 * SIM-B5 / DC-B1 (QA 2026-11-27): a community manager saw every admin section, opened Audit or Customers and got
 * "could not load, try again" forever. The side nav shows only the sections the person's permissions can use; the API
 * still checks every call (hard rule 4).
 */
describe('admin nav by permission (SIM-B5, DC-B1)', () => {
  it('has a rule for every admin section', () => {
    for (const s of ALL_ADMIN_SECTIONS) expect(SECTION_PERMISSIONS).toHaveProperty(s);
  });

  it('gives a community manager the overview and Ustaad only', () => {
    const cm = ROLES.community_manager.permissions;
    expect(sectionsFor(ALL_ADMIN_SECTIONS, cm)).toEqual(['overview', 'ustaad']);
  });

  it('gives a super admin every section', () => {
    expect(sectionsFor(ALL_ADMIN_SECTIONS, ROLES.super_admin.permissions)).toEqual([...ALL_ADMIN_SECTIONS]);
  });

  it('is wired into the admin frame (nav + a plain no-access panel)', () => {
    const src = readFileSync('src/components/portal/admin-console.tsx', 'utf8');
    expect(src).toContain('sectionsFor(ADMIN_SECTIONS, permissions)');
    expect(src).toContain('<NoSectionAccess />');
  });

  it('shows everything while permissions are unknown (the API still refuses)', () => {
    expect(sectionsFor(ALL_ADMIN_SECTIONS, null)).toEqual([...ALL_ADMIN_SECTIONS]);
  });
});
