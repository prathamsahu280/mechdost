import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Both Dockerfiles parse (CI's image build caught these only after merge, twice: a literal "\n" in an ENV continuation
 * on 2026-11-14 and "ENVNEXT_PUBLIC_APP_URL" with no space on 2026-11-15). Every instruction line starts with a known
 * instruction followed by whitespace; continuation lines follow a line ending in a backslash.
 */
const INSTRUCTIONS = new Set([
  'FROM',
  'RUN',
  'CMD',
  'LABEL',
  'EXPOSE',
  'ENV',
  'ADD',
  'COPY',
  'ENTRYPOINT',
  'VOLUME',
  'USER',
  'WORKDIR',
  'ARG',
  'ONBUILD',
  'STOPSIGNAL',
  'HEALTHCHECK',
  'SHELL',
]);

function problems(path: string): string[] {
  const out: string[] = [];
  let continued = false;
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const trimmed = line.trim();
      if (!continued && trimmed !== '' && !trimmed.startsWith('#')) {
        const word = /^(\S+)/.exec(trimmed)?.[1] ?? '';
        if (!INSTRUCTIONS.has(word.toUpperCase()))
          out.push(`line ${String(i + 1)}: "${trimmed.slice(0, 40)}"`);
      }
      if (trimmed.includes('\\n')) out.push(`line ${String(i + 1)}: literal \\n`);
      continued = trimmed.endsWith('\\');
    });
  return out;
}

describe('Dockerfiles', () => {
  it.each(['../Dockerfile', '../../api/Dockerfile'])(
    '%s: every line is an instruction or a continuation',
    (p) => {
      expect(problems(resolve(__dirname, p))).toEqual([]);
    },
  );
});
