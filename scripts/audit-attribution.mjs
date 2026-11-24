#!/usr/bin/env node
/**
 * T15 attribution audit for Earworm (issue #16).
 *
 * Run from anywhere:
 *   node scripts/audit-attribution.mjs [repo-root]
 *
 * Read-only: prints a Markdown report to stdout and exits non-zero on failure.
 * No package.json script is added on purpose: this is a compliance check, not
 * part of the build.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const failures = [];
const checks = [];

const SOURCES = [
  {
    key: 'yt-dual-subs',
    repo: 'Gythiro/yt-dual-subs',
    url: 'https://github.com/Gythiro/yt-dual-subs',
    license: 'MIT',
    copyright: 'Copyright (c) 2026 Gythiro',
    mention: /yt-dual-subs/i,
  },
  {
    key: 'easysubs',
    repo: 'Nitrino/easysubs',
    url: 'https://github.com/Nitrino/easysubs',
    license: 'MIT',
    copyright: 'Copyright (c) 2022 Seo Jong Hak',
    mention: /easysubs/i,
  },
  {
    key: 'SceneLingo',
    repo: 'umutgokbulak/SceneLingo',
    url: 'https://github.com/umutgokbulak/SceneLingo',
    license: 'MIT',
    copyright: 'Copyright (c) 2026 Umut',
    mention: /SceneLingo/i,
  },
];

const ADAPTED_FILES = [
  'src/entrypoints/inject.ts',
  'src/lib/transcript/bridge.ts',
  'src/lib/transcript/client.ts',
  'src/lib/transcript/parse.ts',
  'src/lib/transcript/url.ts',
  'src/lib/llm/client.ts',
  'src/lib/llm/batch.ts',
  'src/features/overlay/Overlay.tsx',
  'src/features/overlay/OverlayView.tsx',
  'src/features/overlay/position.ts',
  'src/features/overlay/use-player-snapshot.ts',
  'src/lib/ui/page-style.ts',
  'src/features/playback/attach.ts',
  'src/features/playback/controller.ts',
  'src/features/playback/keyboard.ts',
  'src/features/sidebar/Sidebar.tsx',
  'src/features/sidebar/SentenceRow.tsx',
  'src/features/sidebar/useAutoScroll.ts',
];

/** Files reviewed and deliberately left without a third-party header. */
const REVIEWED_ORIGINAL = [
  'src/features/overlay/index.ts',
  'src/features/playback/index.ts',
  'src/features/playback/PlaybackShortcuts.tsx',
  'src/lib/llm/cache.ts',
  'src/lib/llm/parse.ts',
  'src/lib/llm/prompt.ts',
  'src/lib/llm/translate-handler.ts',
  'src/lib/transcript/index.ts',
  'src/lib/transcript/__fixtures__/json3.ts',
  'src/features/dictionary/DictionaryCard.tsx',
  'src/features/dictionary/DictionaryPopup.tsx',
  'src/features/dictionary/index.ts',
  'src/features/dictionary/position.ts',
  'src/features/dictionary/selection.ts',
];

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|css)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.output', '.wxt', 'public', 'data']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(full));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function read(file) {
  return readFileSync(path.join(root, file), 'utf8');
}

function headerOf(text) {
  return text.split('\n').slice(0, 40).join('\n');
}

function sourceMentions(text) {
  return SOURCES.filter((source) => source.mention.test(text));
}

function headerHasAttribution(header, source) {
  const hasPrefix = /Adapted for Earworm \(MIT\) from/.test(header);
  const hasRepo = new RegExp(source.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(header) ||
    header.includes(source.url);
  return hasPrefix && hasRepo && header.includes(source.copyright);
}

const SELF = 'scripts/audit-attribution.mjs';
const sourceFiles = walk(root).filter((file) => {
  const relPath = rel(file);
  if (relPath === SELF) return false;
  return relPath.startsWith('src/') || relPath.startsWith('scripts/') || relPath.startsWith('tests/');
});

// 1. Every adapted file exists and carries the required header.
const adaptedRows = [];
for (const file of ADAPTED_FILES) {
  const abs = path.join(root, file);
  let text = '';
  try {
    text = read(file);
  } catch {
    check(`header: ${file}`, false, 'file is missing');
    continue;
  }
  const header = headerOf(text);
  const mentioned = sourceMentions(text);
  const missing = mentioned.filter((source) => !headerHasAttribution(header, source));
  const ok = /Adapted for Earworm \(MIT\) from/.test(header) && missing.length === 0;
  check(`header: ${file}`, ok, missing.map((s) => `missing ${s.repo} / ${s.copyright}`).join('; '));
  adaptedRows.push({
    file,
    sources: mentioned.map((s) => s.key).join(', ') || '(none)',
    header: ok ? 'OK' : 'FAIL',
  });
}

// 2. Every source file that names an upstream has a matching header (no silent copies).
for (const file of sourceFiles) {
  const relPath = rel(file);
  if (ADAPTED_FILES.includes(relPath)) continue;
  const text = readFileSync(file, 'utf8');
  const mentioned = sourceMentions(text);
  if (mentioned.length === 0) continue;
  const header = headerOf(text);
  const missing = mentioned.filter((source) => !headerHasAttribution(header, source));
  check(
    `scan: ${relPath} names ${mentioned.map((s) => s.key).join(', ')}`,
    missing.length === 0,
    missing.length > 0 ? `no matching header for ${missing.map((s) => s.repo).join(', ')}` : '',
  );
}

// 3. Files reviewed as original must not carry a third-party "Adapted for Earworm" header.
for (const file of REVIEWED_ORIGINAL) {
  const text = read(file);
  const header = headerOf(text);
  check(
    `original: ${file}`,
    !/Adapted for Earworm \(MIT\) from/.test(header),
    'unexpected adaptation header',
  );
}

// 4. No GPL/AGPL license text or SPDX grant in source or docs.
const LICENSE_TEXT = /(GNU (?:AFFERO )?GENERAL PUBLIC LICENSE|SPDX-License-Identifier:\s*(?:A?GPL)|GNU Affero)/i;
const gplReferences = [];
const licenseScanFiles = [
  ...sourceFiles,
  ...walk(path.join(root, 'docs')).filter((file) => file.endsWith('.md')),
];
for (const file of licenseScanFiles) {
  const text = readFileSync(file, 'utf8');
  if (!LICENSE_TEXT.test(text)) continue;
  for (const [index, line] of text.split('\n').entries()) {
    if (LICENSE_TEXT.test(line)) {
      gplReferences.push(`${rel(file)}:${index + 1}: ${line.trim()}`);
    }
  }
}
check(
  'no GPL/AGPL license text or SPDX grant',
  gplReferences.length === 0,
  gplReferences.join(' | '),
);

// 5. LICENSE is MIT.
const licenseText = read('LICENSE');
check('LICENSE starts with "MIT License"', /^MIT License\r?\n/.test(licenseText));
check('LICENSE has Earworm copyright', /Copyright \(c\) 2026 Earworm contributors/.test(licenseText));
check('LICENSE has MIT permission text', /Permission is hereby granted, free of charge/.test(licenseText));

// 6. NOTICE contains every required source, license, copyright and data attribution.
const notice = read('NOTICE');
const noticeRequired = [
  ['project license', 'MIT License'],
  ['yt-dual-subs URL', 'https://github.com/Gythiro/yt-dual-subs'],
  ['yt-dual-subs copyright', 'Copyright (c) 2026 Gythiro'],
  ['easysubs URL', 'https://github.com/Nitrino/easysubs'],
  ['easysubs copyright', 'Copyright (c) 2022 Seo Jong Hak'],
  ['SceneLingo URL', 'https://github.com/umutgokbulak/SceneLingo'],
  ['SceneLingo copyright', 'Copyright (c) 2026 Umut'],
  ['ECDICT URL', 'https://github.com/skywind3000/ECDICT'],
  ['ECDICT license', 'Copyright (c) 2025 Linwei'],
  ['CC-BY 4.0', 'CC-BY 4.0'],
  ['OpenSubtitles attribution', 'OpenSubtitles'],
  ['Lison & Tiedemann citation', 'Lison & Tiedemann 2016'],
  ['OpenSubtitles paper title', 'OpenSubtitles2016'],
  ['WXT dependency', 'WXT'],
  ['React dependency', 'React'],
  ['shadcn dependency', 'shadcn/ui'],
  ['MIT permission text', 'Permission is hereby granted, free of charge'],
];
for (const [name, needle] of noticeRequired) {
  check(`NOTICE: ${name}`, notice.includes(needle), needle);
}

// 7. README documents provenance and both regeneration commands.
const readme = read('README.md');
for (const [name, needle] of [
  ['ECDICT source', 'skywind3000/ECDICT'],
  ['ECDICT license', 'MIT'],
  ['OpenSubtitles source', 'opensubs-collocations'],
  ['OpenSubtitles license', 'CC-BY 4.0'],
  ['OpenSubtitles citation', 'Lison & Tiedemann 2016'],
  ['build:ecdict command', 'pnpm build:ecdict'],
  ['build:collocations command', 'pnpm build:collocations'],
  ['NOTICE link', 'NOTICE'],
  ['compliance link', 'docs/compliance.md'],
]) {
  check(`README: ${name}`, readme.includes(needle), needle);
}

// 8. Shipped data carries machine-readable attribution where the build emits it.
const collocations = JSON.parse(read('public/data/collocations.json'));
check(
  'collocations meta license',
  collocations.meta?.license === 'CC-BY-4.0',
  String(collocations.meta?.license),
);
check(
  'collocations meta attribution',
  /OpenSubtitles/.test(collocations.meta?.attribution ?? '') &&
    /Lison/.test(collocations.meta?.attribution ?? ''),
  String(collocations.meta?.attribution),
);
check(
  'collocations meta source URL',
  collocations.meta?.sourceUrl ===
    'https://huggingface.co/datasets/vladvlasov256/opensubs-collocations',
  String(collocations.meta?.sourceUrl),
);

// 9. No adapted file is outside the audited set.
const adaptationHeaders = sourceFiles.filter((file) =>
  /Adapted for Earworm \(MIT\) from/.test(headerOf(readFileSync(file, 'utf8'))),
);
const unaudited = adaptationHeaders.map(rel).filter((file) => !ADAPTED_FILES.includes(file));
check('all "Adapted for Earworm" files are in the audit table', unaudited.length === 0, unaudited.join(', '));

// Report.
const lines = [];
lines.push('## T15 attribution audit');
lines.push('');
lines.push(`Root: \`${root}\``);
lines.push(`Adapted files: ${ADAPTED_FILES.length}`);
lines.push(`Source files mentioning an upstream: ${sourceFiles.filter((file) => sourceMentions(readFileSync(file, 'utf8')).length > 0).length}`);
lines.push('');
lines.push('### Adapted files');
lines.push('');
lines.push('| File | Upstream | Header |');
lines.push('| --- | --- | --- |');
for (const row of adaptedRows) {
  lines.push(`| \`${row.file}\` | ${row.sources} | ${row.header} |`);
}
lines.push('');
lines.push('### Checks');
lines.push('');
for (const item of checks) {
  lines.push(`- ${item.ok ? 'PASS' : 'FAIL'} — ${item.name}${item.detail && !item.ok ? ` (${item.detail})` : ''}`);
}
lines.push('');
lines.push(`### Result`);
lines.push('');
lines.push(failures.length === 0 ? `All ${checks.length} checks passed.` : `${failures.length} failure(s):`);
for (const failure of failures) lines.push(`- ${failure}`);
lines.push('');
lines.push('GPL/AGPL note: only prose references are expected (ADR-0004 and the');
lines.push('`inject.ts` comment explicitly says asbplayer is AGPL and no code was');
lines.push('copied). No GPL/AGPL license text or SPDX grant is present in source or docs.');
console.log(lines.join('\n'));
process.exit(failures.length === 0 ? 0 : 1);
