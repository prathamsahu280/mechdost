/**
 * Ustaad QA audit F-R14 / § 3 row 21 (founder approved 2026-11-27 night): the post composer, the question composer
 * and the message composer keep a local draft (text only; per thread for messages), restore it on return, clear it on
 * send and warn before leaving with unsaved text. Storage may be missing or throw (private mode): everything still
 * works, just without a draft.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearDraft, DRAFT_PREFIX, readDraft, saveDraft } from '../src/lib/ustaad/draft';

function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
  removeItem: (): void => {
    throw new Error('SecurityError');
  },
};

describe('local drafts', () => {
  it('saves, reads back and clears a draft under its own key', () => {
    const s = memoryStore();
    saveDraft('post', 'Clutch plate tip', s);
    expect(s.m.get(`${DRAFT_PREFIX}post`)).toBe('Clutch plate tip');
    expect(readDraft('post', s)).toBe('Clutch plate tip');
    clearDraft('post', s);
    expect(readDraft('post', s)).toBe('');
  });
  it('keeps one draft per message thread', () => {
    const s = memoryStore();
    saveDraft('dm:t1', 'hello', s);
    saveDraft('dm:t2', 'other', s);
    expect(readDraft('dm:t1', s)).toBe('hello');
    expect(readDraft('dm:t2', s)).toBe('other');
  });
  it('blank text removes the draft instead of saving spaces', () => {
    const s = memoryStore();
    saveDraft('question_body', 'x', s);
    saveDraft('question_body', '   ', s);
    expect(s.m.has(`${DRAFT_PREFIX}question_body`)).toBe(false);
  });
  it('a throwing or missing storage never breaks the composer', () => {
    expect(() => {
      saveDraft('post', 'x', throwing);
    }).not.toThrow();
    expect(readDraft('post', throwing)).toBe('');
    expect(() => {
      clearDraft('post', throwing);
    }).not.toThrow();
    expect(readDraft('post', null)).toBe('');
    expect(() => {
      saveDraft('post', 'x', null);
    }).not.toThrow();
  });
  it('without a window (server render) there is no draft', () => {
    expect(readDraft('post')).toBe('');
  });
});

describe('the three composers use the draft hook', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', 'src', 'components', 'ustaad', f), 'utf8');
  it('the hook restores, saves, warns before unload only with text, and clears', () => {
    const h = src('use-draft.ts');
    expect(h).toContain("addEventListener('beforeunload'");
    expect(h).toMatch(/text\.trim\(\)/);
    expect(h).toContain('readDraft(');
    expect(h).toContain('saveDraft(');
    expect(h).toContain('clearDraft(');
  });
  it.each([
    ['post composer', 'feed/composer.tsx', /useDraft\(story \? 'story' : 'post'/],
    ['question composer', 'qa/ask-composer.tsx', /useDraft\('question_body'/],
    ['message composer', 'messages/composer.tsx', /useDraft\(`dm:\$\{threadId\}`/],
  ])('%s keeps a draft and clears it on send', (_, f, call) => {
    const s = src(f);
    expect(s).toMatch(call);
    expect(s).toMatch(/clear\w*Draft\(\)/);
  });
});
