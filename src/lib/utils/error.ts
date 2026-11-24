/** Human-readable message for an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}
