import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    // Tests that assert the absence of a removed symbol must still name it.
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('sidebar removal', () => {
  it('ships no sidebar feature module', () => {
    expect(existsSync(join(REPO, 'src/features/sidebar'))).toBe(false);
  });

  it('leaves no sidebar symbols in source', () => {
    const offenders = sourceFiles(join(REPO, 'src')).filter((file) =>
      /sidebar|earworm-sidebar-host|findSecondarySlot|NESTED_BLUR_CSS/i.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
