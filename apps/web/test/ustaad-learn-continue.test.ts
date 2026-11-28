import { describe, expect, it } from 'vitest';
import type { LearnResourceView, LearnView } from '@mechdost/shared/ustaad/dto/qa';
import { continueLesson } from '@/lib/ustaad/learn-continue';

/** "Continue" (spec 23 § 21i-L, UI upgrade § 3.5): the lesson the member last started and has not finished. */
const res = (id: string, over: Partial<LearnResourceView> = {}): LearnResourceView => ({
  id,
  kind: 'hosted_video',
  titleEn: id,
  titleHi: id,
  segmentCode: null,
  workCode: null,
  durationS: 100,
  mediaId: null,
  url: null,
  label: 'community',
  watchedSeconds: 0,
  completed: false,
  savedByMe: false,
  sizeBytes: null,
  lastWatchedAt: null,
  ...over,
});
const view = (courses: LearnResourceView[][], loose: LearnResourceView[] = []): LearnView => ({
  courses: courses.map((resources, i) => ({
    id: `c${String(i)}`,
    code: `c${String(i)}`,
    titleEn: 'c',
    titleHi: 'c',
    resources,
  })),
  loose,
});

describe('continueLesson', () => {
  it('is null when nothing was started', () => {
    expect(continueLesson(view([[res('a')]], [res('b')]))).toBeNull();
  });
  it('picks the most recently touched lesson that is not finished, in a course or loose', () => {
    const v = view(
      [[res('old', { watchedSeconds: 10, lastWatchedAt: '2026-11-20T10:00:00.000Z' })]],
      [res('new', { watchedSeconds: 5, lastWatchedAt: '2026-11-27T10:00:00.000Z' })],
    );
    expect(continueLesson(v)?.id).toBe('new');
  });
  it('skips finished lessons and links without seconds', () => {
    const v = view([
      [
        res('done', { completed: true, watchedSeconds: 100, lastWatchedAt: '2026-11-28T10:00:00.000Z' }),
        res('link', { kind: 'external_link', lastWatchedAt: '2026-11-28T09:00:00.000Z' }),
        res('half', { watchedSeconds: 40, lastWatchedAt: '2026-11-26T10:00:00.000Z' }),
      ],
    ]);
    expect(continueLesson(v)?.id).toBe('half');
  });
});
