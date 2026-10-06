export type CoreConfig = { url: string; apiKey: string };

/** Core settings from the environment, or null when perimeter core is not set up. */
export function coreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig | null {
  const url = env.PERIMETER_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.PERIMETER_API_KEY?.trim();
  return url && apiKey ? { url, apiKey } : null;
}

export class CoreError extends Error {}

/**
 * Calls core. Errors carry a short reason and never the request text, so a
 * failure cannot echo what was being de-identified.
 */
export async function callCore<T>(
  config: CoreConfig,
  path: string,
  body: unknown,
  method: "POST" | "GET" = "POST",
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CoreError(`perimeter core at ${config.url} could not be reached. Is it running?`);
  }
  if (res.status === 401) throw new CoreError("perimeter core rejected PERIMETER_API_KEY.");
  if (res.status === 403) throw new CoreError("This API key's role is not allowed to do that.");
  if (res.status === 404) throw new CoreError("perimeter core does not know that session.");
  if (res.status === 503) {
    throw new CoreError(
      "perimeter core could not process the text. Do not send the original text anywhere.",
    );
  }
  if (!res.ok) throw new CoreError(`perimeter core answered with status ${res.status}.`);
  return (await res.json()) as T;
}
