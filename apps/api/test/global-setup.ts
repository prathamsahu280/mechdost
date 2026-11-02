import { TEMPLATE_ENV, buildTestDbTemplate } from '@mechdost/db/testing';

/** Migrate once per run; every test file loads a copy (see packages/db/src/testing.ts). */
export default async function setup() {
  process.env[TEMPLATE_ENV] = await buildTestDbTemplate();
}
