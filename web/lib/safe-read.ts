import 'server-only';

/**
 * Wrap a server-side read so the page can render an empty/error state instead of
 * crashing when credentials are absent (offline scaffold) or a read fails.
 *
 * Errors are logged structured and WITHOUT PII (only the operation label and the
 * error message), never the query payload or any secret.
 *
 * @param label short operation name for the log line
 * @param read async read function (typically a `lib/services/*` call)
 * @param fallback value returned when the read throws
 */
export async function safeRead<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<{ data: T; ok: boolean }> {
  try {
    return { data: await read(), ok: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        op: label,
        message: (error as Error).message,
      }),
    );
    return { data: fallback, ok: false };
  }
}
