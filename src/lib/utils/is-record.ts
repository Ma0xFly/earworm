/**
 * Object guards shared by the message, LLM, dictionary and cache validators.
 *
 * Two variants exist because the validators historically differ:
 * - `isRecord` accepts arrays (it guards envelope-like values whose payload may
 *   be an array);
 * - `isPlainRecord` excludes arrays (it guards structured data that must be a
 *   JSON object).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
