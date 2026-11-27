import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The shared Save control sits on the question thread, each answer, the job detail and each Learn lesson (spec 23
 * § 21i, 2026-11-28). The DTOs carry no "saved by me" flag yet, so these start as `saved={false}`; the id is the
 * item's own id (never the public code).
 */
const read = (p: string) => readFileSync(new URL(`../src/components/ustaad/${p}`, import.meta.url), 'utf8');

describe('SaveControl wiring', () => {
  it('the question thread saves the question and each answer', () => {
    const s = read('qa/question-thread.tsx');
    expect(s).toContain("from '../saved/save-control'");
    expect(s).toMatch(/<SaveControl\s+kind="question"\s+id=\{q\.id\}\s+saved=\{false\}/);
    expect(s).toMatch(/<SaveControl\s+kind="answer"\s+id=\{a\.id\}\s+saved=\{false\}/);
  });
  it('the job detail saves the job', () => {
    const s = read('jobs/jobs-view.tsx');
    expect(s).toContain("from '../saved/save-control'");
    expect(s).toMatch(/<SaveControl\s+kind="job"\s+id=\{j\.id\}\s+saved=\{false\}/);
  });
  it('each Learn lesson can be saved', () => {
    const s = read('learn/learn-view.tsx');
    expect(s).toContain("from '../saved/save-control'");
    expect(s).toMatch(/<SaveControl\s+kind="lesson"\s+id=\{r\.id\}\s+saved=\{false\}/);
  });
});
