import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The shared Save control sits on the question thread, each answer, the job detail and each Learn lesson (spec 23
 * § 21i). Each starts in the state the API reports (`savedByMe`, spec 23 § 21i-L); the id is the item's own id (never
 * the public code).
 */
const read = (p: string) => readFileSync(new URL(`../src/components/ustaad/${p}`, import.meta.url), 'utf8');

describe('SaveControl wiring', () => {
  it('the question thread saves the question and each answer, starting from the server flag', () => {
    const s = read('qa/question-thread.tsx');
    expect(s).toContain("from '../saved/save-control'");
    expect(s).toMatch(/<SaveControl\s+kind="question"\s+id=\{q\.id\}\s+saved=\{q\.savedByMe\}/);
    expect(s).toMatch(/<SaveControl\s+kind="answer"\s+id=\{a\.id\}\s+saved=\{a\.savedByMe\}/);
  });
  it('the job detail saves the job', () => {
    const s = read('jobs/jobs-view.tsx');
    expect(s).toContain("from '../saved/save-control'");
    expect(s).toMatch(/<SaveControl\s+kind="job"\s+id=\{j\.id\}\s+saved=\{j\.savedByMe\}/);
  });
  it('each Learn lesson can be saved', () => {
    const s = read('learn/learn-view.tsx');
    expect(s).toContain("from '../saved/save-control'");
    expect(s).toMatch(/<SaveControl\s+kind="lesson"\s+id=\{r\.id\}\s+saved=\{r\.savedByMe\}/);
  });
});
