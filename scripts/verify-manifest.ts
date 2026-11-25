/**
 * Assert the WXT build output satisfies the T1 manifest contract.
 *
 * Run automatically at the end of `pnpm build` and imported by
 * `tests/manifest.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ContentScript = {
  matches?: string[];
  js?: string[];
  run_at?: string;
  world?: string;
};

type Manifest = {
  manifest_version?: number;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: ContentScript[];
  background?: { service_worker?: string };
  icons?: Record<string, string>;
  options_ui?: { page?: string; open_in_tab?: boolean };
  web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>;
};

export function manifestProblems(outputDir: string): string[] {
  const problems: string[] = [];
  const manifestPath = path.join(outputDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return [`missing built manifest: ${manifestPath}`];
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch (error) {
    return [`built manifest is not valid JSON: ${String(error)}`];
  }

  const fileExists = (relative: string): boolean => existsSync(path.join(outputDir, relative));

  if (manifest.manifest_version !== 3) {
    problems.push(`manifest_version must be 3, got ${String(manifest.manifest_version)}`);
  }

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];

  const mainWorld = contentScripts.find((script) => script.world === 'MAIN');
  if (!mainWorld) {
    problems.push('missing MAIN world content script (inject.ts)');
  } else {
    if (mainWorld.run_at !== 'document_start') {
      problems.push(`MAIN world script run_at must be "document_start", got ${String(mainWorld.run_at)}`);
    }
    if (!mainWorld.matches?.includes('https://www.youtube.com/*')) {
      problems.push('MAIN world script does not match https://www.youtube.com/*');
    }
    const mainJs = mainWorld.js ?? [];
    if (!mainJs.includes('inject.js')) {
      problems.push(`MAIN world script js must include "inject.js", got ${JSON.stringify(mainJs)}`);
    }
    for (const file of mainJs) {
      if (!fileExists(file)) problems.push(`content script file missing from build: ${file}`);
    }

    // MAIN-world scripts cannot use `chrome.*` (the API is isolated-world
    // only). T3 verified this by hand; keep it asserted in the build gate.
    const injectPath = path.join(outputDir, 'inject.js');
    if (!existsSync(injectPath)) {
      problems.push('inject.js missing from build');
    } else {
      const injectSource = readFileSync(injectPath, 'utf8');
      if (/\bchrome\s*\./.test(injectSource)) {
        problems.push(
          'MAIN-world inject.js must not reference chrome.* (chrome APIs are unavailable in the MAIN world)',
        );
      }
    }
  }

  const isolated = contentScripts.find(
    (script) =>
      script.world !== 'MAIN' &&
      (script.js ?? []).some((file) => file === 'content-scripts/content.js'),
  );
  if (!isolated) {
    problems.push('missing isolated content script content-scripts/content.js');
  } else if (!fileExists('content-scripts/content.js')) {
    problems.push('content-scripts/content.js missing from build');
  }

  if (!manifest.background?.service_worker) {
    problems.push('missing background.service_worker');
  } else if (!fileExists(manifest.background.service_worker)) {
    problems.push(`background file missing from build: ${manifest.background.service_worker}`);
  }

  if (!manifest.options_ui?.page) {
    problems.push('missing options_ui.page');
  } else {
    if (manifest.options_ui.page !== 'options.html') {
      problems.push(`options_ui.page must be "options.html", got ${manifest.options_ui.page}`);
    }
    if (manifest.options_ui.open_in_tab !== true) {
      problems.push('options_ui.open_in_tab must be true');
    }
    if (!fileExists(manifest.options_ui.page)) {
      problems.push(`options page missing from build: ${manifest.options_ui.page}`);
    }
  }

  if (!manifest.permissions?.includes('storage')) {
    problems.push('permissions must include "storage"');
  }

  for (const origin of ['http://127.0.0.1/*', 'http://localhost/*']) {
    if (!manifest.host_permissions?.includes(origin)) {
      problems.push(`host_permissions must include ${origin}`);
    }
  }
  for (const origin of ['http://*/*', 'https://*/*']) {
    if (!manifest.optional_host_permissions?.includes(origin)) {
      problems.push(`optional_host_permissions must include ${origin}`);
    }
  }

  const dataWar = (manifest.web_accessible_resources ?? []).find((entry) =>
    entry.resources?.includes('data/*'),
  );
  if (!dataWar) {
    problems.push('web_accessible_resources must expose "data/*"');
  } else if (!dataWar.matches?.includes('https://www.youtube.com/*')) {
    problems.push('"data/*" web_accessible_resource must match YouTube');
  }
  if (!fileExists('data/README.md')) {
    problems.push('public/data/README.md was not copied into the build output');
  }

  // The finalized logo is the only extension icon. WXT's auto-discovery
  // cannot see public/brand/, so the contract must be asserted explicitly.
  const expectedIcons: Record<string, string> = {
    '16': 'brand/earworm-icon-16.png',
    '32': 'brand/earworm-icon-32.png',
    '48': 'brand/earworm-icon-48.png',
    '128': 'brand/earworm-icon-128.png',
  };
  for (const [size, relative] of Object.entries(expectedIcons)) {
    if (manifest.icons?.[size] !== relative) {
      problems.push(`icons.${size} must be "${relative}", got ${String(manifest.icons?.[size])}`);
    }
    if (!fileExists(relative)) {
      problems.push(`icon file missing from build output: ${relative}`);
    }
  }
  if (Object.values(manifest.icons ?? {}).includes('brand/earworm-icon-source.png')) {
    problems.push('earworm-icon-source.png is a source asset and must not be a browser icon');
  }

  const brandWar = (manifest.web_accessible_resources ?? []).find((entry) =>
    entry.resources?.includes('brand/*'),
  );
  if (!brandWar) {
    problems.push('web_accessible_resources must expose "brand/*"');
  } else if (!brandWar.matches?.includes('https://www.youtube.com/*')) {
    problems.push('"brand/*" web_accessible_resource must match YouTube');
  }

  // Attribution must ship with the distributed extension package, not only in
  // the source repository (WXT copies these via the build:publicAssets hook).
  for (const file of ['LICENSE', 'NOTICE']) {
    if (!fileExists(file)) {
      problems.push(`attribution file missing from the build output: ${file}`);
    }
  }

  return problems;
}

export function verifyBuiltManifest(outputDir: string): void {
  const problems = manifestProblems(outputDir);
  if (problems.length > 0) {
    throw new Error(
      `Built manifest does not satisfy the Earworm T1 contract:\n- ${problems.join('\n- ')}`,
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const outputDir = path.resolve(process.cwd(), '.output/chrome-mv3');
  verifyBuiltManifest(outputDir);
  console.log(`[earworm] manifest + build output OK: ${path.relative(process.cwd(), outputDir)}`);
}
