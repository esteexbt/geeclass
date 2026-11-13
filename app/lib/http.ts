// Reads an API response safely: a crashed or empty server reply becomes a clear message, not a JSON error.
export async function readRes<T = Record<string, unknown>>(r: Response): Promise<T & { error?: string }> {
  const text = await r.text();
  if (!text) {
    return {
      error: r.ok
        ? "The server sent an empty reply. Try again."
        : `The server hit a problem (${r.status}). If this keeps happening, check the Supabase keys in your hosting settings.`,
    } as T & { error?: string };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: `The server replied with something unexpected (${r.status}). Try again in a moment.` } as T & { error?: string };
  }
}
