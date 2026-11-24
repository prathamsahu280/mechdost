import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normaliseProductPicture } from '../photos/normalise';

/**
 * The picture step of the Tata Green, CEAT and MRF importers: the source folder is never touched. Each picture is
 * evened out in memory by `normaliseProductPicture` (plain border trimmed, product centred on a square canvas, at most
 * 1600 px, at most 2x enlarged), once per file, and a copy is written to a temp folder so the result can be looked at.
 * Watermarks, site URLs and logos are never painted out: a picture that carries one is left out with `--skip-photos-for`.
 */
export function normalisedPictures(
  tempPrefix: string,
  readPicture: (dir: string, file: string) => Buffer,
): {
  read(dir: string, file: string): Promise<Buffer>;
  report(): string | null;
} {
  const stats = { processed: 0, trimmed: 0, enlarged: 0, reduced: 0, matte: 0 };
  const cache = new Map<string, Promise<Buffer>>();
  let outDir: string | null = null;
  return {
    read(dir, file) {
      let hit = cache.get(file);
      if (!hit) {
        hit = normaliseProductPicture(readPicture(dir, file)).then((n) => {
          stats.processed += 1;
          if (n.trimmed) stats.trimmed += 1;
          if (n.scale > 1.001) stats.enlarged += 1;
          if (n.scale < 0.999) stats.reduced += 1;
          if (n.background === 'matte') stats.matte += 1;
          outDir ??= mkdtempSync(join(tmpdir(), tempPrefix));
          const name = `${String(stats.processed).padStart(3, '0')}-${file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')}.png`;
          mkdirSync(outDir, { recursive: true });
          writeFileSync(join(outDir, name.replace(/[^\w. ()-]+/g, '_')), n.data);
          return n.data;
        });
        cache.set(file, hit);
      }
      return hit;
    },
    report: () =>
      stats.processed > 0
        ? `pictures normalised: ${JSON.stringify(stats)}; copies in ${outDir ?? ''}\n`
        : null,
  };
}
