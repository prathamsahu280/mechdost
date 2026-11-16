/**
 * The deploy must not fill the server's disk (incident 2026-11-15: "no space left on device" while pulling the web
 * image; every deploy left its tagged images behind and `docker image prune -f` removes only untagged ones). The
 * server step removes every image no container uses before it pulls (room for the new layers) and again after.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(__dirname, '..', '..', '..', '.github', 'workflows', 'deploy.yml'),
  'utf8',
);
const step = workflow.slice(
  workflow.indexOf('Update the stack on the server'),
  workflow.indexOf('Public check'),
);

describe('deploy workflow keeps the server disk clear', () => {
  it('removes unused images before pulling the new ones', () => {
    const prune = step.indexOf('docker image prune -af');
    const pull = step.indexOf('docker compose pull');
    expect(prune).toBeGreaterThan(-1);
    expect(pull).toBeGreaterThan(-1);
    expect(prune).toBeLessThan(pull);
  });

  it('removes unused images again after the stack is up, and reports free disk space', () => {
    const up = step.indexOf('docker compose up');
    expect(step.indexOf('docker image prune -af', up)).toBeGreaterThan(up);
    expect(step).toMatch(/df -h/);
  });
});

describe('deploy workflow checks the stack stays up (2026-11-16: the worker crash-looped after a green deploy)', () => {
  const check = workflow.slice(workflow.indexOf('Stack stays up'), workflow.indexOf('Public check'));
  it('waits, then fails when a service is not running or the worker never started', () => {
    expect(workflow.indexOf('Stack stays up')).toBeGreaterThan(
      workflow.indexOf('Update the stack on the server'),
    );
    expect(check).toMatch(/sleep \d+/);
    expect(check).toMatch(/grep -v ' running\$'/);
    expect(check).toMatch(/grep -q worker_started/);
    expect(check).not.toMatch(/continue-on-error/);
  });
});
