import { TEMPLATE_ENV, buildTestDbTemplate } from '../src/testing';

/** Migrate once per run; every test file loads a copy (see src/testing.ts). */
export default async function setup() {
  process.env[TEMPLATE_ENV] = await buildTestDbTemplate();
}
