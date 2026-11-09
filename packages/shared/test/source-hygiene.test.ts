/**
 * No invisible characters in source files (code review 2026-11-04): a zero-width space, BOM, line separator or
 * NUL in a test input or a regex reads as nothing to a reviewer and as something to the program. Write them as
 * `\u…` escapes instead. Joiners (U+200D) and variation selectors (U+FE0F) are allowed: emoji contain them.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const INVISIBLE = /[\u200b\u200c\u2028\u2029\ufeff]/u;
const NUL = String.fromCharCode(0);

describe('source hygiene', () => {
  it('tracked source files contain no invisible characters', () => {
    const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mjs', '*.sql'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    const offenders = files.flatMap((file) =>
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')

        .flatMap((line, i) =>
          INVISIBLE.test(line) || line.includes(NUL) ? [`${file}:${String(i + 1)}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
  }, 30_000); // reads every tracked file: slower than a unit test on a busy machine
});
