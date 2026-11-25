import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { manifestProblems } from '../scripts/verify-manifest';

const outputDir = path.resolve(process.cwd(), '.output/chrome-mv3');
const manifestPath = path.join(outputDir, 'manifest.json');

/**
 * Asserts the REAL built extension manifest (not just the config source).
 *
 * `pnpm build` runs the same verification. When tests run before build, this
 * hook produces the build once so the assertions always inspect fresh output.
 */
beforeAll(() => {
  if (!existsSync(manifestPath)) {
    execFileSync('pnpm', ['build'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }
  expect(existsSync(manifestPath)).toBe(true);
}, 240_000);

describe('built extension manifest', () => {
  it('satisfies the T1 manifest contract', () => {
    expect(manifestProblems(outputDir)).toEqual([]);
  });

  it('ships the public data directory into the unpacked extension', () => {
    expect(existsSync(path.join(outputDir, 'data', 'README.md'))).toBe(true);
  });

  it('ships the finalized logo as extension icons and exposes brand assets to YouTube', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      icons?: Record<string, string>;
      web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>;
    };

    for (const size of ['16', '32', '48', '128']) {
      const expected = `brand/earworm-icon-${size}.png`;
      expect(manifest.icons?.[size], `icons.${size}`).toBe(expected);
      expect(existsSync(path.join(outputDir, expected)), expected).toBe(true);
    }
    expect(manifest.icons && Object.values(manifest.icons)).not.toContain(
      'brand/earworm-icon-source.png',
    );

    const brandWar = (manifest.web_accessible_resources ?? []).find((entry) =>
      entry.resources?.includes('brand/*'),
    );
    expect(brandWar, 'web_accessible_resources must expose brand/*').toBeDefined();
    expect(brandWar?.matches).toContain('https://www.youtube.com/*');
  });

  it('ships attribution and keeps the MAIN-world inject script chrome-free', () => {
    for (const file of ['LICENSE', 'NOTICE']) {
      expect(existsSync(path.join(outputDir, file)), file).toBe(true);
    }

    const inject = readFileSync(path.join(outputDir, 'inject.js'), 'utf8');
    expect(inject).not.toMatch(/\bchrome\s*\./);
  });
});
