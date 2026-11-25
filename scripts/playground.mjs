/**
 * Earworm — playground launcher placeholder.
 *
 * T14 owns `playground/`. Until it lands, print a friendly message instead of
 * a Vite "config not found" stack trace. Once `playground/vite.config.ts`
 * exists this launcher starts Vite with that config, so package.json never
 * needs to change again.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(root, 'playground', 'vite.config.ts');

if (!existsSync(configFile)) {
  console.log('[earworm] playground is not implemented yet (ticket T14).');
  console.log('[earworm] it will live in playground/ with its own vite.config.ts.');
  process.exitCode = 1;
  process.exit(1);
}

const { createServer } = await import('vite');
const server = await createServer({
  root: path.join(root, 'playground'),
  configFile,
});
await server.listen();
server.printUrls();
