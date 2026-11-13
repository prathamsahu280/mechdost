/**
 * CI flake 2026-11-13: MapLibre creates the "find my location" button without a name and labels it only after an
 * async permission check. On a slow runner axe ran in that gap (button-name). Here the permission check never
 * answers, so the gap stays open: the button must still have a name.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';

test.use({ storageState: CONSENT_DECIDED });

test('the locate button on a workshop map has a name before the permission check answers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if ('permissions' in navigator) {
      navigator.permissions.query = () => new Promise<PermissionStatus>(() => undefined);
    }
  });
  await page.goto('/workshops/shankar-nagar-auto-hub');
  const button = page.locator('.maplibregl-ctrl-geolocate');
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-label', /\S/);
  const results = await new AxeBuilder({ page })
    .include('.maplibregl-ctrl-geolocate')
    .withTags(['wcag2a'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
