import { writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { deliveryWorld } from './fixtures/delivery-world';

// Temporary: writes the delivery world for the screenshot script (deleted after use, never committed).
test('dump delivery world', () => {
  writeFileSync(process.env.DUMP_TO ?? 'delivery-world.json', JSON.stringify(deliveryWorld(Date.now())));
});
