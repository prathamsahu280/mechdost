import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productFullName } from '../src/lib/product-name';

describe('productFullName (live check 2026-11-22: "Gulf GULF PRIDE 20W-40")', () => {
  it('does not repeat a brand the name already starts with', () => {
    expect(productFullName('Gulf', 'GULF PRIDE 20W-40')).toBe('GULF PRIDE 20W-40');
    expect(productFullName('KELVINN', 'KELVINN UPHOLSTERY CLEANER FOAM')).toBe(
      'KELVINN UPHOLSTERY CLEANER FOAM',
    );
    expect(productFullName('Tata Green', 'TATA GREEN TG Series')).toBe('TATA GREEN TG Series');
    expect(productFullName('Tata Green', 'Tata-Green Premio')).toBe('Tata-Green Premio');
  });
  it('adds the brand when the name does not start with it', () => {
    expect(productFullName('Castrol', 'Activ 4T 20W40 900 ml')).toBe('Castrol Activ 4T 20W40 900 ml');
    expect(productFullName('Gulf', 'Gulfstream')).toBe('Gulf Gulfstream');
    expect(productFullName('', 'Brake pads')).toBe('Brake pads');
  });
  it('every brand + name join in the web app goes through it', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?)$/.test(f)) {
          const src = readFileSync(p, 'utf8');
          if (
            /\$\{([a-zA-Z.]+)\.brand(\.name)?\} \$\{\1\.name\}|\{([a-zA-Z.]+)\.brand(\.name)?\} \{\3\.name\}/.test(
              src,
            )
          )
            offenders.push(p);
        }
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
    // Reads every source file: about 1 s alone, 7 s when the PC runs other suites or builds (2026-11-24).
  }, 30_000);
});
